import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Order, User, OrderStatus, ReturnReason } from '../types';
import { Button } from './Button';
import { Download, Search, RotateCcw, CheckCircle2, UserCircle, ArrowRightLeft, CheckSquare, Camera, Mic, X, Image as ImageIcon, Aperture, ScanLine, BrainCircuit, Filter } from 'lucide-react';
import ExcelJS from 'exceljs';
import { GoogleGenAI } from "@google/genai";

interface ResultsViewProps {
  orders: Order[];
  currentUser: User;
  onReset: () => void;
  onUpdateOrder: (orderId: string, updates: Partial<Order>) => void;
}

// --- STRICT JS COMPARISON LOGIC ---
const normalizeString = (str: string) => {
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
};

// OCR Ambiguity Whitelist (Strict)
// Only these pairs are allowed to be swapped.
const ALLOWED_SWAPS: Record<string, string[]> = {
  '0': ['O', 'Q', 'D'],
  'O': ['0', 'Q', 'D'],
  'Q': ['0', 'O'],
  'D': ['0', 'O'],
  '8': ['B'],
  'B': ['8'],
  'Z': ['2'],
  '2': ['Z'],
  '1': ['I', 'L'],
  'I': ['1', 'L'],
  'L': ['1', 'I'],
  '5': ['S'],
  'S': ['5'],
  // Note: '6', '9', '7', 'E' generally do not have safe alphanumeric swaps in this context.
  // '7' vs '2' is NOT here, so it will FAIL.
};

const strictCompare = (target: string, candidate: string): { match: boolean; reason: string; score: number } => {
  const normTarget = normalizeString(target);
  const normCand = normalizeString(candidate);

  // 1. Length Check (Allow max 1 char difference, usually OCR drops a char)
  if (Math.abs(normTarget.length - normCand.length) > 1) {
    return { match: false, reason: `长度不符 (目标:${normTarget.length}, 识别:${normCand.length})`, score: 0 };
  }

  let diffCount = 0;
  const length = Math.min(normTarget.length, normCand.length);
  const diffDetails = [];

  for (let i = 0; i < length; i++) {
    const charT = normTarget[i];
    const charC = normCand[i];

    if (charT !== charC) {
      // Check Whitelist
      const allowed = ALLOWED_SWAPS[charT];
      if (allowed && allowed.includes(charC)) {
        // It's a fuzzy match (e.g. 8 vs B), we count it but allow it
        diffCount += 0.5; // Penalty for fuzzy match
        diffDetails.push(`Pos ${i+1}: '${charC}'视为'${charT}'`);
      } else {
        // HARD MISMATCH (e.g. 7 vs 2, 6 vs 8)
        return { 
          match: false, 
          reason: `字符不匹配: 第${i+1}位 识别为'${charC}'，应为'${charT}' (严禁匹配)`, 
          score: 0 
        };
      }
    }
  }

  // Max fuzzy allowance: equivalent to 2 fuzzy chars (score 1.0)
  if (diffCount > 1.0) {
    return { match: false, reason: `模糊匹配过多 (${diffDetails.join(', ')})`, score: 0 };
  }

  return { 
    match: true, 
    reason: diffCount === 0 ? "完全精确匹配" : `模糊匹配成功: ${diffDetails.join(', ')}`, 
    score: 1 
  };
};

export const ResultsView: React.FC<ResultsViewProps> = ({ orders, currentUser, onReset, onUpdateOrder }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  // Transfer Modal State
  const [transferTarget, setTransferTarget] = useState<{orderId: string, currentName: string} | null>(null);
  const [newOwnerName, setNewOwnerName] = useState('');

  // Completion Modal State
  const [completionTarget, setCompletionTarget] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState<ReturnReason | ''>('');
  const [remark, setRemark] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null); // Base64
  const [audioData, setAudioData] = useState<{name: string, data: string} | null>(null);
  
  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null); // Ref for native file input
  const [cameraError, setCameraError] = useState<string | null>(null);

  // AI Verification State
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    match: boolean;
    detected: string;
    message: string;
  } | null>(null);

  // Extract unique teams for dropdown
  const uniqueTeams = useMemo(() => {
    const teams = new Set(orders.map(o => o.team).filter(Boolean));
    return Array.from(teams).sort();
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const lowerTerm = searchTerm.toLowerCase().trim();
    
    // Filter by User Identity
    let visibleOrders = orders;
    if (currentUser.role === 'WORKER') {
      visibleOrders = orders.filter(o => o.userName === currentUser.name);
    }

    // Filter Logic
    const results = visibleOrders.filter(order => {
      // 1. Search Term
      const matchesSearch = !lowerTerm || Object.values(order).some(val => 
        String(val).toLowerCase().includes(lowerTerm)
      );

      // 2. Status Filter
      const matchesStatus = statusFilter === 'ALL' || order.status === statusFilter;

      // 3. Team Filter
      const matchesTeam = teamFilter === 'ALL' || order.team === teamFilter;

      return matchesSearch && matchesStatus && matchesTeam;
    });

    // Sort
    return results.sort((a, b) => {
      const aTask = a.taskName.toLowerCase();
      const bTask = b.taskName.toLowerCase();
      if (aTask === lowerTerm && bTask !== lowerTerm) return -1;
      if (bTask === lowerTerm && aTask !== lowerTerm) return 1;
      return 0;
    });
  }, [orders, searchTerm, currentUser, statusFilter, teamFilter]);

  // --- AI Verification Logic (Architecture: AI OCR -> JS Judge) ---
  const verifyImageWithAI = async () => {
    if (!photoData || !completionTarget) return;

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey || apiKey.trim() === '') {
         throw new Error("未配置 API Key。请在根目录 .env 文件中配置 API_KEY，或联系管理员。");
      }

      const ai = new GoogleGenAI({ apiKey });
      const base64Data = photoData.split(',')[1];
      const targetCode = completionTarget.serialCode;

      // New Prompt: Pure OCR Extraction. No judgment.
      const promptText = `
        Task: Extract all alphanumeric strings found in this image.
        
        Instructions:
        1. Look for strings that resemble Serial Numbers, MAC addresses, Device IDs, or Barcodes.
        2. Ignore labels like "MAC:", "SN:", "Model:". Just return the values.
        3. Be precise. Do not correct spelling. Return exactly what you see.
        4. Return a JSON object with an array of strings.

        Output Format:
        {
          "candidates": ["string1", "string2", "string3"]
        }
      `;

      // 使用通用 Flash 模型进行 OCR，支持多模态输入，且配额通常更宽松
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', 
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
            { text: promptText }
          ]
        },
        config: {
          temperature: 0.1, // Low temp for precision
        }
      });

      const responseText = response.text || "{}";
      console.log("AI OCR Response:", responseText);

      // 1. Parse AI Output
      let candidates: string[] = [];
      try {
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonString);
        candidates = parsed.candidates || [];
      } catch (e) {
        console.warn("JSON Parse Failed", e);
        // Fallback: simple regex extraction if JSON fails
        const matches = responseText.match(/[A-Z0-9\-\:]{6,}/gi);
        if (matches) candidates = Array.from(matches);
      }

      if (candidates.length === 0) {
        setVerificationResult({
          match: false,
          detected: "未检测到文字",
          message: "无法从图片中识别出任何有效的字母数字串，请尝试更清晰的角度。"
        });
        return;
      }

      // 2. Strict JS Comparison
      let bestMatch = { match: false, reason: "未找到匹配项", score: -1, detected: "" };
      
      for (const cand of candidates) {
        const result = strictCompare(targetCode, cand);
        
        // Prioritize: True Match > Higher Fuzzy Score > Anything else
        if (result.match) {
          bestMatch = { ...result, detected: cand };
          break; // Stop on first valid match
        } else {
          // Keep track of the "closest" failure for debugging feedback
          // Heuristic: If it failed but had a specific reason (not length mismatch), it might be the right code scanned incorrectly
          if (!result.reason.includes("长度") && bestMatch.score === -1) {
             bestMatch = { ...result, detected: cand };
          }
        }
      }

      // 3. Set Result
      setVerificationResult({
        match: bestMatch.match,
        detected: bestMatch.detected || candidates[0], // Show what we tried
        message: bestMatch.match 
          ? bestMatch.reason 
          : `匹配失败: ${bestMatch.reason || "图片中的文字与订单不符"}`
      });

    } catch (error: any) {
      console.error("AI Verification Error:", error);
      const isKeyError = error.message.includes("API Key");
      // Detect Rate Limit / Quota errors
      const isQuotaError = error.message.includes("429") || error.message.includes("quota") || error.message.includes("RESOURCE_EXHAUSTED");
      
      let msg = `服务错误: ${error.message || "请重试"}`;
      if (isKeyError) msg = "请配置 API Key (.env)";
      if (isQuotaError) msg = "请求过于频繁(429)。请等待约 1 分钟后再试，或检查配额。";

      setVerificationResult({
        match: false,
        detected: isQuotaError ? "配额超限" : "系统错误",
        message: msg
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // --- Camera Logic (Web RTC) ---
  const startCamera = async () => {
    setCameraError(null);
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Prefer back camera on mobile
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera Error:", err);
      // For Workers, we don't suggest system camera as fallback to enforce "No Album"
      const errorMsg = currentUser.role === 'WORKER' 
        ? "无法访问网页相机。请检查浏览器权限，或确认已使用 HTTPS 访问。执行人员仅允许使用实时相机。" 
        : "无法访问网页相机 (可能是权限或HTTPS问题)。请尝试下方“调用系统相机”按钮。";
      setCameraError(errorMsg);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw video frame
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Add watermark
        addWatermarkToCanvas(canvas);

        // Convert to Base64 (JPEG 0.8 quality)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPhotoData(dataUrl);
        // Clear previous AI result when new photo is taken
        setVerificationResult(null); 
        stopCamera();
      }
    }
  };

  // --- Native System Camera Logic (Fallback) ---
  const handleNativeCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
           // Draw image to canvas to add watermark
           const canvas = document.createElement('canvas');
           const ctx = canvas.getContext('2d');
           if (ctx) {
             canvas.width = img.width;
             canvas.height = img.height;
             ctx.drawImage(img, 0, 0);
             
             // Add Watermark
             addWatermarkToCanvas(canvas);
             
             const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
             setPhotoData(dataUrl);
             // Clear previous AI result
             setVerificationResult(null); 
           }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const addWatermarkToCanvas = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return;

    // Add Watermark (Formatted Time YYYY-MM-DD HH:mm:ss)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    // Responsive font size (3.5% of width, min 24px)
    const fontSize = Math.max(24, Math.floor(canvas.width * 0.035));
    
    context.font = `bold ${fontSize}px monospace`;
    context.textBaseline = 'bottom';
    
    // Measure text for background box
    const textMetrics = context.measureText(timeString);
    const textWidth = textMetrics.width;
    const textHeight = fontSize * 1.2; // Approximate line height
    
    // Position: Bottom Right with padding
    const paddingX = fontSize * 0.8;
    const paddingY = fontSize * 0.8;
    const x = canvas.width - textWidth - paddingX;
    const y = canvas.height - paddingY;

    // Draw Background Box (Semi-transparent black)
    const boxPadding = fontSize * 0.4;
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    
    if (typeof context.roundRect === 'function') {
        context.beginPath();
        context.roundRect(
            x - boxPadding, 
            y - fontSize + (fontSize * 0.15), 
            textWidth + (boxPadding * 2), 
            textHeight, 
            8 
        );
        context.fill();
    } else {
        context.fillRect(
            x - boxPadding, 
            y - fontSize + (fontSize * 0.15), 
            textWidth + (boxPadding * 2), 
            textHeight
        );
    }

    // Draw Text
    context.fillStyle = '#ffffff';
    context.fillText(timeString, x, y + (fontSize * 0.1));
  };

  // --- Audio Logic ---
  const handleAudioImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
           setAudioData({
             name: file.name,
             data: event.target.result as string
           });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Workflow Actions ---
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Orders');

      // Define Columns
      sheet.columns = [
        { header: '任务名称', key: 'taskName', width: 15 },
        { header: '业务号', key: 'businessNo', width: 20 },
        { header: '班组', key: 'team', width: 15 },
        { header: '姓名', key: 'userName', width: 15 },
        { header: '串码', key: 'serialCode', width: 25 },
        { header: '状态', key: 'status', width: 10 },
        { header: '回单现象', key: 'returnReason', width: 20 },
        { header: '回单备注', key: 'completionRemark', width: 30 },
        { header: '现场照片', key: 'photo', width: 40 }, // Wide column for photo
        { header: '录音', key: 'audio', width: 10 },
        { header: '最新处理', key: 'lastHistory', width: 40 },
      ];

      // Add Data
      for (const order of filteredOrders) {
        const rowData = {
          taskName: order.taskName,
          businessNo: order.businessNo,
          team: order.team,
          userName: order.userName,
          serialCode: order.serialCode,
          status: getStatusLabel(order.status),
          returnReason: order.returnReason || '',
          completionRemark: order.completionRemark || '',
          photo: '', // Placeholder, image goes here
          audio: order.completionAudio ? '有' : '无',
          lastHistory: order.history[order.history.length - 1] || ''
        };

        const row = sheet.addRow(rowData);

        // Embed Image if exists
        if (order.completionPhoto) {
          // completionPhoto is "data:image/jpeg;base64,..."
          const imageId = workbook.addImage({
            base64: order.completionPhoto,
            extension: 'jpeg',
          });

          // Insert image into the 'photo' column (index 8, 0-based) of the current row
          sheet.addImage(imageId, {
            tl: { col: 8, row: row.number - 1 }, // Top-left anchor
            br: { col: 9, row: row.number }      // Bottom-right anchor
          } as any);

          // Increase row height to show image
          row.height = 150; 
        } else {
          row.height = 25; // Standard height
        }
        
        // Alignment
        row.eachCell((cell) => {
          cell.alignment = { vertical: 'middle', wrapText: true };
        });
      }

      // Generate Buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      // Download
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `orders_export_${currentUser.name}_${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(anchor); // Append to body for better mobile support
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
      alert("导出失败。如果在 App 中无法导出，请尝试使用手机浏览器（如 Chrome）打开此网页进行操作。");
    } finally {
      setIsExporting(false);
    }
  };

  const handleReceive = (order: Order) => {
    // Removed confirm dialog for better UX
    const currentHistory = Array.isArray(order.history) ? order.history : [];
    
    onUpdateOrder(order.id, {
      status: 'RECEIVED',
      receivedAt: new Date().toISOString(),
      history: [...currentHistory, `${currentUser.name} 于 ${new Date().toLocaleString()} 接收订单`]
    });
  };

  const openCompletionModal = (order: Order) => {
    setCompletionTarget(order);
    setReturnReason(order.returnReason || '');
    setRemark(order.completionRemark || '');
    setPhotoData(order.completionPhoto || null);
    setVerificationResult(null); // Reset AI result
    // Note: We don't preload audio data for display simplicity, but could if needed
    setAudioData(null); 
  };

  const closeCompletionModal = () => {
    setCompletionTarget(null);
    stopCamera();
    setReturnReason('');
    setRemark('');
    setPhotoData(null);
    setAudioData(null);
    setVerificationResult(null);
  };

  const submitCompletion = () => {
    if (!completionTarget) return;
    
    if (currentUser.role === 'ADMIN' || completionTarget.status === 'COMPLETED') {
        closeCompletionModal();
        return;
    }

    if (!returnReason) {
      alert('请选择回单现象');
      return;
    }

    const currentHistory = Array.isArray(completionTarget.history) ? completionTarget.history : [];
    
    // Add AI verification note to history if performed
    const verificationNote = verificationResult 
      ? `(AI核对: ${verificationResult.match ? '通过' : '失败'} - 识别为 ${verificationResult.detected})` 
      : '';

    onUpdateOrder(completionTarget.id, {
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      returnReason: returnReason as ReturnReason,
      completionRemark: remark + (remark && verificationNote ? ' ' : '') + verificationNote,
      completionPhoto: photoData || undefined,
      completionAudio: audioData?.data || undefined,
      history: [...currentHistory, `${currentUser.name} 于 ${new Date().toLocaleString()} 完成回单 ${verificationNote}`]
    });

    closeCompletionModal();
  };

  // --- Transfer Logic ---
  const openTransferModal = (order: Order) => {
    setTransferTarget({ orderId: order.id, currentName: order.userName });
    setNewOwnerName('');
  };

  const confirmTransfer = () => {
    if (!transferTarget || !newOwnerName.trim()) return;
    
    // Safe history access
    const targetOrder = orders.find(o => o.id === transferTarget.orderId);
    const currentHistory = targetOrder && Array.isArray(targetOrder.history) ? targetOrder.history : [];

    onUpdateOrder(transferTarget.orderId, {
      userName: newOwnerName.trim(),
      history: [...currentHistory, 
        `${currentUser.name} 转派给 ${newOwnerName} 于 ${new Date().toLocaleString()}`]
    });
    setTransferTarget(null);
  };

  const getStatusLabel = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING': return '待派发';
      case 'DISPATCHED': return '待接收';
      case 'RECEIVED': return '处理中';
      case 'COMPLETED': return '已完成';
      default: return status;
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING': return 'bg-slate-100 text-slate-600';
      case 'DISPATCHED': return 'bg-amber-100 text-amber-700'; // Changed to Amber for visibility
      case 'RECEIVED': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'COMPLETED': return 'bg-green-100 text-green-700';
      default: return 'bg-slate-100';
    }
  };
  
  // Helper to determine if current user can edit the modal
  const canEditCompletion = completionTarget?.status === 'RECEIVED' && currentUser.role === 'WORKER';

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 relative">
      
      {/* --- Completion Modal (Used for Input AND Viewing) --- */}
      {completionTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
               <div>
                 <h3 className="text-lg font-bold text-slate-800">
                    {canEditCompletion ? '填写回单' : '回单详情'}
                 </h3>
                 <p className="text-xs text-slate-500">业务号: {completionTarget.businessNo}</p>
               </div>
               <button onClick={closeCompletionModal} className="text-slate-400 hover:text-slate-600">
                 <X size={24} />
               </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* 1. Return Reason */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  1. 回单现象 <span className="text-red-500">*</span>
                </label>
                <select 
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value as ReturnReason)}
                  disabled={!canEditCompletion}
                >
                  <option value="">请选择现象...</option>
                  <option value="家中无人无法上门">家中无人无法上门</option>
                  <option value="终端在现场使用">终端在现场使用</option>
                  <option value="目标终端无法找到">目标终端无法找到</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              {/* 2. Remark */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  2. 备注
                </label>
                <textarea 
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  rows={3}
                  placeholder="填写其他现场情况说明..."
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  disabled={!canEditCompletion}
                />
              </div>

              {/* 3. Photo with Watermark */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    3. 现场拍照 (带时间水印)
                  </label>
                  {/* AI Verify Button (Only show if photo exists and we are editing) */}
                  {canEditCompletion && photoData && (
                    <button 
                      onClick={verifyImageWithAI}
                      disabled={isVerifying}
                      className="text-xs flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full border border-indigo-200 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                      {isVerifying ? (
                        <span className="animate-pulse">AI 识别中...</span>
                      ) : (
                        <>
                          <BrainCircuit size={14} />
                          智能核对串码
                        </>
                      )}
                    </button>
                  )}
                </div>
                
                {/* Native Input Hidden */}
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment"
                  className="hidden"
                  ref={nativeInputRef}
                  onChange={handleNativeCameraCapture}
                />

                {/* Camera Trigger - Only show if editing and no photo yet, or if camera open */}
                {canEditCompletion && !isCameraOpen && !photoData && (
                  <div className={`grid gap-4 ${currentUser.role === 'WORKER' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                     {/* Standard Web Camera - Always Available */}
                     <Button onClick={startCamera} variant="outline" className="h-32 flex flex-col gap-2 border-dashed">
                       <Camera size={32} />
                       <span>打开网页相机</span>
                       {currentUser.role === 'WORKER' && (
                         <span className="text-[10px] text-slate-400">请使用实时拍照</span>
                       )}
                     </Button>
                     
                     {/* Native Camera (Fallback) - HIDDEN FOR WORKERS to prevent album import */}
                     {currentUser.role !== 'WORKER' && (
                       <Button onClick={() => nativeInputRef.current?.click()} variant="outline" className="h-32 flex flex-col gap-2 border-dashed bg-slate-50 hover:bg-slate-100">
                         <Aperture size={32} className="text-blue-600" />
                         <span>调用系统相机</span>
                         <span className="text-[10px] text-slate-400">推荐(兼容性好)</span>
                       </Button>
                     )}
                  </div>
                )}

                {/* Live Camera View */}
                {isCameraOpen && (
                  <div className="relative bg-black rounded-lg overflow-hidden">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-64 object-cover" />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                      <Button onClick={takePhoto} className="rounded-full w-12 h-12 flex items-center justify-center bg-white text-black hover:bg-slate-200">
                        <div className="w-10 h-10 border-2 border-black rounded-full"></div>
                      </Button>
                      <Button onClick={stopCamera} variant="danger" className="rounded-full px-4">取消</Button>
                    </div>
                  </div>
                )}

                {/* Photo Display */}
                {photoData ? (
                  <div className="space-y-2">
                    <div className="relative group bg-slate-900 rounded-lg overflow-hidden h-64 flex items-center justify-center">
                      <img 
                        src={photoData} 
                        alt="Captured" 
                        className="max-h-full max-w-full object-contain" 
                      />
                      {canEditCompletion && (
                          <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center gap-2 transition-all">
                          <Button onClick={() => setPhotoData(null)} variant="secondary" className="text-xs">
                              重拍
                          </Button>
                          </div>
                      )}
                    </div>
                    
                    {/* AI Verification Result Alert */}
                    {verificationResult && (
                      <div className={`p-3 rounded-lg text-sm flex items-start gap-2 border ${
                        verificationResult.match 
                          ? 'bg-green-50 border-green-200 text-green-800' 
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}>
                        {verificationResult.match ? (
                          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                        ) : (
                          <ScanLine size={18} className="shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-bold">{verificationResult.match ? "匹配成功" : "匹配失败/未识别"}</p>
                          <p>{verificationResult.message}</p>
                          {!verificationResult.match && verificationResult.detected !== 'Error' && (
                             <p className="mt-1 text-xs opacity-80">识别结果: {verificationResult.detected}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                    !canEditCompletion && !isCameraOpen && (
                        <div className="p-4 bg-slate-100 text-slate-500 text-center rounded-lg text-sm">
                            无照片
                        </div>
                    )
                )}
                
                {cameraError && (
                    <div className="mt-2 text-sm text-red-500 bg-red-50 p-2 rounded flex flex-col gap-2">
                        <p>{cameraError}</p>
                        {/* Only show fallback button if NOT worker */}
                        {currentUser.role !== 'WORKER' && (
                          <Button 
                              variant="outline" 
                              onClick={() => nativeInputRef.current?.click()}
                              className="bg-white border-red-200 text-red-600"
                          >
                              点击此处使用系统相机
                          </Button>
                        )}
                    </div>
                )}
              </div>

              {/* 4. Audio Import */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  4. 录音导入
                </label>
                <div className="flex items-center gap-3">
                  {canEditCompletion ? (
                    <label className="flex-1">
                        <input 
                        type="file" 
                        accept="audio/*" 
                        className="hidden" 
                        onChange={handleAudioImport}
                        />
                        <div className="flex items-center justify-center gap-2 w-full p-3 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors text-slate-600">
                        <Mic size={18} />
                        {audioData ? '已选择文件: ' + audioData.name : '点击选择录音文件'}
                        </div>
                    </label>
                  ) : (
                      <div className="flex-1 p-3 bg-slate-100 border border-slate-200 rounded-lg text-slate-500 flex items-center gap-2">
                          <Mic size={18} />
                          {completionTarget.completionAudio ? '有录音文件 (导出查看)' : '无录音'}
                      </div>
                  )}

                  {canEditCompletion && audioData && (
                    <button onClick={() => setAudioData(null)} className="text-red-500 hover:text-red-700 p-2">
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 justify-end bg-slate-50 rounded-b-xl">
              <Button variant="outline" onClick={closeCompletionModal}>
                  {canEditCompletion ? '取消' : '关闭'}
              </Button>
              {canEditCompletion && (
                  <Button onClick={submitCompletion} disabled={!returnReason}>提交回单</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Transfer Modal --- */}
      {transferTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">转派订单</h3>
            <p className="text-sm text-slate-500 mb-4">
              当前处理人: <span className="font-semibold text-slate-800">{transferTarget.currentName}</span>
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">转派给 (姓名)</label>
              <input 
                autoFocus
                className="w-full p-2 border rounded"
                value={newOwnerName}
                onChange={e => setNewOwnerName(e.target.value)}
                placeholder="输入新姓名..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setTransferTarget(null)}>取消</Button>
              <Button onClick={confirmTransfer} disabled={!newOwnerName.trim()}>确认转派</Button>
            </div>
          </div>
        </div>
      )}

      {/* Header Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 font-medium">我的订单</p>
            <h2 className="text-3xl font-bold text-slate-800">{filteredOrders.length}</h2>
          </div>
          <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <UserCircle size={24} />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col h-[calc(100vh-250px)] min-h-[600px]">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-slate-50">
          
          {/* Search & Filters Group */}
          <div className="flex flex-col md:flex-row gap-3 w-full xl:w-auto flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="搜索任务名称、业务号..."
                className="pl-10 w-full p-2 bg-white border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="flex gap-2">
                <div className="relative">
                   <select 
                        value={statusFilter} 
                        onChange={e => setStatusFilter(e.target.value as any)}
                        className="appearance-none pl-8 pr-8 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                    >
                        <option value="ALL">全部状态</option>
                        <option value="PENDING">待派发</option>
                        <option value="DISPATCHED">待接收</option>
                        <option value="RECEIVED">处理中</option>
                        <option value="COMPLETED">已完成</option>
                    </select>
                    <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                <div className="relative">
                    <select 
                        value={teamFilter} 
                        onChange={e => setTeamFilter(e.target.value)}
                        className="appearance-none pl-8 pr-8 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                    >
                        <option value="ALL">全部班组</option>
                        {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <UserCircle size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </div>
          </div>
          
          <div className="flex gap-3 w-full xl:w-auto">
             {currentUser.role === 'ADMIN' && (
                <Button variant="outline" onClick={onReset} className="flex-1 xl:flex-none whitespace-nowrap">
                  <RotateCcw size={16} className="mr-2" /> 导入新数据
                </Button>
             )}
             <Button onClick={handleExport} className="flex-1 xl:flex-none whitespace-nowrap" isLoading={isExporting}>
               <Download size={16} className="mr-2" /> 导出 Excel
             </Button>
          </div>
        </div>

        {/* Table/List */}
        <div className="flex-1 overflow-auto bg-slate-50 p-4">
          {filteredOrders.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOrders.map((order) => (
                <div 
                  key={order.id} 
                  className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all p-5 flex flex-col space-y-3 relative group 
                    ${order.status === 'RECEIVED' ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'}
                  `}
                >
                  <div className="flex justify-between items-start border-b border-slate-100 pb-2">
                    <span className="bg-slate-800 text-white text-xs font-semibold px-2.5 py-0.5 rounded">
                      {order.taskName}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between">
                       <span className="text-xs text-slate-500">业务号</span>
                       <span className="text-sm font-medium text-slate-800">{order.businessNo}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-xs text-slate-500">班组</span>
                       <span className="text-sm font-medium text-slate-800">{order.team}</span>
                    </div>
                    <div className="flex justify-between">
                       <span className="text-xs text-slate-500">处理人</span>
                       <span className="text-sm font-medium text-blue-600">{order.userName}</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <div className="bg-slate-50 p-2 rounded text-center border border-slate-100 mb-3">
                      <span className="text-xs text-slate-500 block uppercase tracking-wider mb-1">串码</span>
                      <span className="font-mono text-sm font-bold text-slate-700 break-all">{order.serialCode}</span>
                    </div>

                    {/* Display indicators if completed */}
                    {order.status === 'COMPLETED' && (
                       <div className="flex gap-2 mb-3 text-xs text-slate-500">
                          {order.completionPhoto && <span className="flex items-center"><ImageIcon size={12} className="mr-1"/>有照片</span>}
                          {order.completionAudio && <span className="flex items-center"><Mic size={12} className="mr-1"/>有录音</span>}
                       </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {/* Receive Button: Only for Worker, if Dispatched or Pending */}
                      {currentUser.role === 'WORKER' && (order.status === 'DISPATCHED' || order.status === 'PENDING') && (
                        <Button 
                          onClick={() => handleReceive(order)}
                          className="w-full text-xs py-1"
                        >
                          <CheckCircle2 size={14} className="mr-1" /> 接收
                        </Button>
                      )}

                      {/* Complete Button: Only for Worker, if Received */}
                      {currentUser.role === 'WORKER' && order.status === 'RECEIVED' && (
                        <Button 
                          onClick={() => openCompletionModal(order)}
                          className="w-full text-xs py-1 bg-green-600 hover:bg-green-700"
                        >
                          <CheckSquare size={14} className="mr-1" /> 回单
                        </Button>
                      )}

                      {/* View Details/Modify (Both Worker AND Admin can view completed) */}
                      {(currentUser.role === 'WORKER' || currentUser.role === 'ADMIN') && order.status === 'COMPLETED' && (
                        <Button 
                          variant="outline"
                          onClick={() => openCompletionModal(order)}
                          className="w-full text-xs py-1"
                        >
                          查看回单
                        </Button>
                      )}

                      {/* Transfer Button: Available for Admin only */}
                      {currentUser.role === 'ADMIN' && (
                        <Button 
                          variant="secondary"
                          onClick={() => openTransferModal(order)}
                          className="w-full text-xs py-1"
                        >
                          <ArrowRightLeft size={14} className="mr-1" /> 转派
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-full text-slate-400">
               <Search size={48} className="mb-4 opacity-20" />
               <p>
                 {currentUser.role === 'WORKER' 
                   ? `未找到属于 "${currentUser.name}" 的订单` 
                   : `未找到匹配 "${searchTerm}" 的订单`}
               </p>
               {(statusFilter !== 'ALL' || teamFilter !== 'ALL') && (
                   <p className="mt-2 text-xs text-slate-500">
                       (已应用筛选条件: {statusFilter !== 'ALL' ? '状态 ' : ''}{teamFilter !== 'ALL' ? '班组' : ''})
                   </p>
               )}
             </div>
          )}
        </div>
        
        <div className="p-3 bg-white border-t border-slate-200 text-xs text-slate-500 flex justify-between">
           <span>显示 {filteredOrders.length} / {orders.length} 条记录</span>
           <span>当前用户: {currentUser.name} ({currentUser.role === 'ADMIN' ? '管理员' : '员工'})</span>
        </div>
      </div>
    </div>
  );
};