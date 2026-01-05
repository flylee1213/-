import React, { useState, useMemo, useRef } from 'react';
import { Order, User, OrderStatus, ReturnReason } from '../types';
import { Button } from './Button';
import { Download, Search, RotateCcw, CheckCircle2, UserCircle, ArrowRightLeft, CheckSquare, Camera, Mic, X, Image as ImageIcon, Aperture, ScanLine, BrainCircuit, Filter, Settings, Server, MapPin, Clock, Edit2, CalendarClock, Map, Users, Plus, Trash2, RefreshCw } from 'lucide-react';
import ExcelJS from 'exceljs';
import { TEAM_DATA, DISTRICTS } from '../data/teamData';

interface ResultsViewProps {
  orders: Order[];
  currentUser: User;
  onReset: () => void;
  onRefresh?: () => void;
  onUpdateOrder: (orderId: string, updates: Partial<Order>) => void;
}

// --- STRICT JS COMPARISON LOGIC ---
const normalizeString = (str: string) => {
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
};

// OCR Ambiguity Whitelist (Strict)
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
};

const strictCompare = (target: string, candidate: string): { match: boolean; reason: string; score: number } => {
  const normTarget = normalizeString(target);
  const normCand = normalizeString(candidate);

  // 1. Length Check
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
      const allowed = ALLOWED_SWAPS[charT];
      if (allowed && allowed.includes(charC)) {
        diffCount += 0.5;
        diffDetails.push(`Pos ${i+1}: '${charC}'视为'${charT}'`);
      } else {
        return { 
          match: false, 
          reason: `字符不匹配: 第${i+1}位 识别为'${charC}'，应为'${charT}' (严禁匹配)`, 
          score: 0 
        };
      }
    }
  }

  if (diffCount > 1.0) {
    return { match: false, reason: `模糊匹配过多 (${diffDetails.join(', ')})`, score: 0 };
  }

  return { 
    match: true, 
    reason: diffCount === 0 ? "完全精确匹配" : `模糊匹配成功: ${diffDetails.join(', ')}`, 
    score: 1 
  };
};

// --- COORDINATE TRANSFORM (WGS84 -> GCJ02) ---
// Fixes GPS offset for Chinese Maps (Amap/Gaode)
const wgs84ToGcj02 = (lat: number, lon: number): [number, number] => {
  const PI = 3.1415926535897932384626;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;

  if (outOfChina(lat, lon)) return [lat, lon];

  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [lat + dLat, lon + dLon];
};

const transformLat = (x: number, y: number) => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
};

const transformLon = (x: number, y: number) => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
};

const outOfChina = (lat: number, lon: number) => {
  if (lon < 72.004 || lon > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  return false;
};

// --- ALIBABA QWEN API HANDLER ---
const callQwenVL = async (apiKey: string, base64Image: string, prompt: string) => {
  const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen-vl-max",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: base64Image } } // OpenAI compatible format handles base64 data URI
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`阿里云 Qwen API 错误 (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "{}";
};

export const ResultsView: React.FC<ResultsViewProps> = ({ orders, currentUser, onReset, onRefresh, onUpdateOrder }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [districtFilter, setDistrictFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  // Default to QWEN only
  const [qwenApiKey, setQwenApiKey] = useState(() => localStorage.getItem('qwen_api_key') || process.env.QWEN_KEY || '');
  // Amap Key (Default provided by user)
  const [amapKey, setAmapKey] = useState(() => localStorage.getItem('amap_api_key') || '0a0f148bea0fd959a629c2a6247c110e');

  // Transfer Modal State
  const [transferTarget, setTransferTarget] = useState<{orderId: string, currentName: string} | null>(null);
  const [newOwnerName, setNewOwnerName] = useState('');

  // Deadline Edit Modal State
  const [deadlineEditTarget, setDeadlineEditTarget] = useState<{ id: string, oldDeadline: string } | null>(null);
  const [newDeadlineDate, setNewDeadlineDate] = useState('');

  // Completion Modal State
  const [completionTarget, setCompletionTarget] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState<ReturnReason | ''>('');
  const [remark, setRemark] = useState('');
  const [remarkImages, setRemarkImages] = useState<string[]>([]); // New state for remark images
  const [photoData, setPhotoData] = useState<string | null>(null); // Base64
  const [audioData, setAudioData] = useState<{name: string, data: string} | null>(null);
  
  // Camera & Location State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null); // Ref for native file input
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [locationText, setLocationText] = useState<string>('');

  // AI Verification State
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    match: boolean;
    detected: string;
    message: string;
  } | null>(null);

  // Helper: Check if a team belongs to a district
  const isTeamInDistrict = (teamName: string, district: string) => {
    return TEAM_DATA[district]?.includes(teamName);
  };

  // Extract unique teams for dropdown (Fallback for ALL districts)
  const uniqueTeams = useMemo(() => {
    const teams = new Set(orders.map(o => o.team).filter(Boolean));
    return Array.from(teams).sort();
  }, [orders]);

  // Available Teams based on District selection
  const availableTeamsForFilter = useMemo(() => {
    if (districtFilter === 'ALL') {
      return uniqueTeams;
    }
    return TEAM_DATA[districtFilter] || [];
  }, [districtFilter, uniqueTeams]);

  // Handle District Change
  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDistrictFilter(e.target.value);
    setTeamFilter('ALL'); // Reset team filter when district changes
  };

  const filteredOrders = useMemo(() => {
    const lowerTerm = searchTerm.toLowerCase().trim();
    
    let visibleOrders = orders;
    
    // WORKER FILTERING LOGIC
    if (currentUser.role === 'WORKER') {
      visibleOrders = orders.filter(o => {
          // 1. Must be assigned to current user's NAME
          const isNameMatch = o.userName === currentUser.name;
          // 2. Must be assigned to current user's TEAM (if team is set)
          const isTeamMatch = currentUser.team ? o.team === currentUser.team : true;

          if (!isNameMatch || !isTeamMatch) return false;
          
          return true;
      });
    }

    const results = visibleOrders.filter(order => {
      const matchesSearch = !lowerTerm || Object.values(order).some(val => 
        String(val).toLowerCase().includes(lowerTerm)
      );
      const matchesStatus = statusFilter === 'ALL' || order.status === statusFilter;
      const matchesDistrict = districtFilter === 'ALL' || (order.team && isTeamInDistrict(order.team, districtFilter));
      const matchesTeam = teamFilter === 'ALL' || order.team === teamFilter;
      
      return matchesSearch && matchesStatus && matchesDistrict && matchesTeam;
    });

    return results.sort((a, b) => {
      const aTask = a.taskName.toLowerCase();
      const bTask = b.taskName.toLowerCase();
      if (aTask === lowerTerm && bTask !== lowerTerm) return -1;
      if (bTask === lowerTerm && aTask !== lowerTerm) return 1;
      return 0;
    });
  }, [orders, searchTerm, currentUser, statusFilter, districtFilter, teamFilter]);

  // --- Settings Handler ---
  const handleSaveSettings = () => {
    localStorage.setItem('qwen_api_key', qwenApiKey);
    localStorage.setItem('amap_api_key', amapKey);
    setShowSettings(false);
    alert('系统配置已保存。');
  };

  // --- Location Handler ---
  const fetchLocation = () => {
    if (!navigator.geolocation) {
      setLocationText('不支持定位');
      return;
    }

    setLocationText('正在获取地址...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const [gcjLat, gcjLon] = wgs84ToGcj02(latitude, longitude);
        if (amapKey) {
            try {
                const res = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${gcjLon},${gcjLat}&extensions=base`);
                const data = await res.json();
                if (data.status === '1' && data.regeocode && data.regeocode.formatted_address) {
                    setLocationText(data.regeocode.formatted_address);
                } else {
                    setLocationText(`位置: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
                }
            } catch (error) {
                console.error("Amap API Error:", error);
                setLocationText(`位置: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            }
        } else {
             setLocationText(`位置: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        setLocationText('无法获取定位');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  // --- AI Verification Logic (QWEN Only) ---
  const verifyImageWithAI = async () => {
    if (!photoData || !completionTarget) return;
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      if (!qwenApiKey) throw new Error("未配置阿里云 API Key。请在设置中输入。");
      const promptText = `
        Task: Extract all alphanumeric strings found in this image.
        Instructions:
        1. Look for strings that resemble Serial Numbers, MAC addresses, Device IDs, or Barcodes.
        2. Ignore labels like "MAC:", "SN:", "Model:". Just return the values.
        3. Be precise. Do not correct spelling. Return exactly what you see.
        4. Return a JSON object with an array of strings.
        Output Format: {"candidates": ["string1", "string2"]}
      `;
      const responseText = await callQwenVL(qwenApiKey, photoData, promptText);
      console.log(`[QWEN] OCR Response:`, responseText);
      let candidates: string[] = [];
      try {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0].replace(/```json/g, '').replace(/```/g, '') : responseText;
        const parsed = JSON.parse(jsonStr);
        candidates = parsed.candidates || [];
      } catch (e) {
        console.warn("JSON Parse Failed", e);
        const matches = responseText.match(/[A-Z0-9\-\:]{6,}/gi);
        if (matches) candidates = Array.from(matches);
      }
      if (candidates.length === 0) {
        setVerificationResult({ match: false, detected: "未检测到文字", message: "无法从图片中识别出任何有效的字母数字串，请尝试更清晰的角度。" });
        return;
      }
      const targetCode = completionTarget.serialCode;
      let bestMatch = { match: false, reason: "未找到匹配项", score: -1, detected: "" };
      for (const cand of candidates) {
        const result = strictCompare(targetCode, cand);
        if (result.match) {
          bestMatch = { ...result, detected: cand };
          break; 
        } else {
          if (!result.reason.includes("长度") && bestMatch.score === -1) {
             bestMatch = { ...result, detected: cand };
          }
        }
      }
      setVerificationResult({ match: bestMatch.match, detected: bestMatch.detected || candidates[0], message: bestMatch.match ? bestMatch.reason : `匹配失败: ${bestMatch.reason || "图片中的文字与订单不符"}` });
    } catch (error: any) {
      console.error("AI Verification Error:", error);
      let msg = `服务错误: ${error.message || "请重试"}`;
      let detected = "系统错误";
      const isQuotaError = error.message.includes("429") || error.message.includes("quota");
      if (isQuotaError) { msg = "请求过于频繁(429)。"; detected = "配额超限"; }
      setVerificationResult({ match: false, detected: detected, message: msg });
    } finally {
      setIsVerifying(false);
    }
  };

  // --- Camera Logic ---
  const startCamera = async () => {
    setCameraError(null);
    setIsCameraOpen(true);
    fetchLocation();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera Error:", err);
      setCameraError(currentUser.role === 'WORKER' ? "无法访问网页相机，请检查权限。" : "无法访问网页相机，请尝试系统相机。");
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
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        addWatermarkToCanvas(canvas);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPhotoData(dataUrl);
        setVerificationResult(null); 
        stopCamera();
      }
    }
  };

  const handleNativeCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
           const canvas = document.createElement('canvas');
           const ctx = canvas.getContext('2d');
           if (ctx) {
             canvas.width = img.width;
             canvas.height = img.height;
             ctx.drawImage(img, 0, 0);
             addWatermarkToCanvas(canvas);
             const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
             setPhotoData(dataUrl);
             setVerificationResult(null); 
           }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const addWatermarkToCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const fontSize = Math.max(16, Math.min(60, Math.floor(width * 0.035)));
    const lineHeight = fontSize * 1.3;
    const padding = fontSize * 0.6;
    const margin = fontSize * 0.6;
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const addrStr = locationText || "位置信息获取中...";
    ctx.font = `bold ${fontSize}px sans-serif`;
    const maxTextWidth = width - (margin * 2) - (padding * 2);
    const addressLines: string[] = [];
    let currentLine = '';
    for (const char of addrStr) {
        const testLine = currentLine + char;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine !== '') {
            addressLines.push(currentLine);
            currentLine = char;
        } else {
            currentLine = testLine;
        }
    }
    addressLines.push(currentLine);
    let maxContentWidth = ctx.measureText(timeStr).width;
    for (const line of addressLines) {
        const m = ctx.measureText(line);
        if (m.width > maxContentWidth) maxContentWidth = m.width;
    }
    const boxWidth = maxContentWidth + (padding * 2);
    const boxHeight = (addressLines.length * lineHeight) + lineHeight + (padding * 2) + (lineHeight * 0.2);
    const x = width - boxWidth - margin;
    const y = height - boxHeight - margin;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    let currentY = y + padding;
    for (const line of addressLines) {
        ctx.fillText(line, x + padding, currentY);
        currentY += lineHeight;
    }
    currentY += (lineHeight * 0.2);
    ctx.fillText(timeStr, x + padding, currentY);
  };

  const handleAudioImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) setAudioData({ name: file.name, data: event.target.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Remark Image Handlers ---
  const handleRemarkImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) {
            setRemarkImages(prev => [...prev, ev.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeRemarkImage = (index: number) => {
    setRemarkImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleManualRefresh = async () => {
    if (onRefresh) {
        setIsRefreshing(true);
        await onRefresh();
        setIsRefreshing(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Orders');
      sheet.columns = [
        { header: '任务名称', key: 'taskName', width: 15 },
        { header: '业务号', key: 'businessNo', width: 20 },
        { header: '班组', key: 'team', width: 15 },
        { header: '姓名', key: 'userName', width: 15 },
        { header: '串码', key: 'serialCode', width: 25 },
        { header: '状态', key: 'status', width: 10 },
        { header: '截止时间', key: 'deadline', width: 20 },
        { header: '回单现象', key: 'returnReason', width: 20 },
        { header: '回单备注', key: 'completionRemark', width: 30 },
        { header: '备注图片', key: 'remarkImages', width: 15 },
        { header: '现场照片', key: 'photo', width: 40 },
        { header: '录音', key: 'audio', width: 10 },
        { header: '最新处理', key: 'lastHistory', width: 40 },
      ];
      for (const order of filteredOrders) {
        const rowData = {
          taskName: order.taskName,
          businessNo: order.businessNo,
          team: order.team,
          userName: order.userName,
          serialCode: order.serialCode,
          status: getStatusLabel(order.status),
          deadline: order.deadline ? new Date(order.deadline).toLocaleString() : '',
          returnReason: order.returnReason || '',
          completionRemark: order.completionRemark || '',
          remarkImages: order.remarkImages && order.remarkImages.length > 0 ? `${order.remarkImages.length} 张图片` : '',
          photo: '',
          audio: order.completionAudio ? '有' : '无',
          lastHistory: order.history[order.history.length - 1] || ''
        };
        const row = sheet.addRow(rowData);
        
        let hasImage = false;

        // Embed Remark Image (First one)
        if (order.remarkImages && order.remarkImages.length > 0) {
           const base64 = order.remarkImages[0];
           if (base64) {
               const imageId = workbook.addImage({ base64: base64, extension: 'jpeg' });
               sheet.addImage(imageId, { 
                   tl: { col: 9, row: row.number - 1 }, 
                   br: { col: 10, row: row.number } 
               } as any);
               hasImage = true;
           }
        }

        // Embed Completion Photo
        if (order.completionPhoto) {
          const imageId = workbook.addImage({ base64: order.completionPhoto, extension: 'jpeg' });
          sheet.addImage(imageId, { tl: { col: 10, row: row.number - 1 }, br: { col: 11, row: row.number } } as any);
          hasImage = true;
        }

        if (hasImage) {
          row.height = 150; 
        } else {
          row.height = 25;
        }
        row.eachCell((cell) => { cell.alignment = { vertical: 'middle', wrapText: true }; });
      }
      const buffer = await workbook.xlsx.writeBuffer() as any;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `orders_export_${currentUser.name}_${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
      alert("导出失败，请重试。");
    } finally {
      setIsExporting(false);
    }
  };

  const handleReceive = (order: Order) => {
    if (order.deadline && new Date() > new Date(order.deadline)) {
        alert("该订单已过截止时间，无法操作。");
        return;
    }
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
    setRemarkImages(order.remarkImages || []); // Load existing remark images
    setPhotoData(order.completionPhoto || null);
    setVerificationResult(null); 
    setAudioData(null); 
    if (currentUser.role === 'WORKER' && (order.status === 'RECEIVED' || order.status === 'COMPLETED')) {
        fetchLocation();
    }
  };

  const closeCompletionModal = () => {
    setCompletionTarget(null);
    stopCamera();
    setReturnReason('');
    setRemark('');
    setRemarkImages([]);
    setPhotoData(null);
    setAudioData(null);
    setVerificationResult(null);
    setLocationText(''); 
  };

  const submitCompletion = () => {
    if (!completionTarget) return;
    if (currentUser.role === 'WORKER' && completionTarget.deadline && new Date() > new Date(completionTarget.deadline)) {
        alert("该订单已过截止时间，无法提交或修改。");
        closeCompletionModal();
        return;
    }
    if (currentUser.role === 'ADMIN') { closeCompletionModal(); return; }
    if (!returnReason) { alert('请选择回单现象'); return; }
    if (!photoData) { alert('请拍摄现场照片'); return; }

    const currentHistory = Array.isArray(completionTarget.history) ? completionTarget.history : [];
    const verificationNote = verificationResult ? `(AI核对: ${verificationResult.match ? '通过' : '失败'} - 识别为 ${verificationResult.detected})` : '';
    const isUpdate = completionTarget.status === 'COMPLETED';
    const actionDesc = isUpdate ? '修改了回单' : '完成回单';

    onUpdateOrder(completionTarget.id, {
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      returnReason: returnReason as ReturnReason,
      completionRemark: remark + (remark && verificationNote ? ' ' : '') + verificationNote,
      remarkImages: remarkImages, // Save remark images
      completionPhoto: photoData || undefined,
      completionAudio: audioData?.data || undefined,
      history: [...currentHistory, `${currentUser.name} 于 ${new Date().toLocaleString()} ${actionDesc} ${verificationNote}`]
    });
    closeCompletionModal();
  };

  const openTransferModal = (order: Order) => {
    setTransferTarget({ orderId: order.id, currentName: order.userName });
    setNewOwnerName('');
  };

  const confirmTransfer = () => {
    if (!transferTarget || !newOwnerName.trim()) return;
    const targetOrder = orders.find(o => o.id === transferTarget.orderId);
    const currentHistory = targetOrder && Array.isArray(targetOrder.history) ? targetOrder.history : [];
    onUpdateOrder(transferTarget.orderId, {
      userName: newOwnerName.trim(),
      history: [...currentHistory, `${currentUser.name} 转派给 ${newOwnerName} 于 ${new Date().toLocaleString()}`]
    });
    setTransferTarget(null);
  };

  const openDeadlineModal = (order: Order) => {
    setDeadlineEditTarget({ id: order.id, oldDeadline: order.deadline || '' });
    if (order.deadline) {
        const d = new Date(order.deadline);
        const pad = (n: number) => n < 10 ? '0' + n : n;
        const localIso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        setNewDeadlineDate(localIso);
    } else {
        setNewDeadlineDate('');
    }
  };

  const handleSaveDeadline = () => {
    if (!deadlineEditTarget) return;
    const currentHistory = orders.find(o => o.id === deadlineEditTarget.id)?.history || [];
    const newHistoryEntry = `${currentUser.name} 于 ${new Date().toLocaleString()} 修改截止时间`;
    onUpdateOrder(deadlineEditTarget.id, {
        deadline: newDeadlineDate ? new Date(newDeadlineDate).toISOString() : null,
        history: [...currentHistory, newHistoryEntry]
    });
    setDeadlineEditTarget(null);
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
      case 'DISPATCHED': return 'bg-amber-100 text-amber-700'; 
      case 'RECEIVED': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'COMPLETED': return 'bg-green-100 text-green-700';
      default: return 'bg-slate-100';
    }
  };
  
  const isTargetExpired = completionTarget?.deadline && new Date() > new Date(completionTarget.deadline);
  const canEditCompletion = (completionTarget?.status === 'RECEIVED' || completionTarget?.status === 'COMPLETED') && currentUser.role === 'WORKER' && !isTargetExpired;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 relative">
      
      {/* --- Settings Modal --- */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Settings size={20} />
              系统设置
            </h3>
            
            <div className="space-y-5">
              <div>
                 <label className="block text-sm font-medium text-slate-800 flex items-center gap-2">
                   <Server size={16} /> 阿里云 Qwen API Key
                 </label>
                 <p className="text-xs text-slate-500 mb-2 mt-1">
                   用于 OCR 识别。
                 </p>
                 <input 
                    type="password"
                    className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                    value={qwenApiKey}
                    onChange={e => setQwenApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
              </div>

              <div>
                 <label className="block text-sm font-medium text-slate-800 flex items-center gap-2">
                   <MapPin size={16} /> 高德地图 API Key (Web服务)
                 </label>
                 <p className="text-xs text-slate-500 mb-2 mt-1">
                   用于将 GPS 坐标转换为中文地址。
                 </p>
                 <input 
                    type="text"
                    className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                    value={amapKey}
                    onChange={e => setAmapKey(e.target.value)}
                    placeholder="请输入 Key..."
                  />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <Button variant="outline" onClick={() => setShowSettings(false)}>取消</Button>
              <Button onClick={handleSaveSettings}>保存配置</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Completion Modal --- */}
      {completionTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
               <div>
                 <h3 className="text-lg font-bold text-slate-800">
                    {canEditCompletion ? '填写/修改回单' : '回单详情'}
                 </h3>
                 <p className="text-xs text-slate-500">业务号: {completionTarget.businessNo}</p>
                 {completionTarget.deadline && (
                    <p className={`text-xs mt-1 ${isTargetExpired ? 'text-red-500 font-bold' : 'text-amber-600'}`}>
                        截止时间: {new Date(completionTarget.deadline).toLocaleString()}
                        {isTargetExpired && ' (已截止 - 无法修改)'}
                    </p>
                 )}
               </div>
               <button onClick={closeCompletionModal} className="text-slate-400 hover:text-slate-600">
                 <X size={24} />
               </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  1. 回单现象 {canEditCompletion && <span className="text-red-500">*</span>}
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

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">2. 备注 & 附件</label>
                <textarea 
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 mb-2"
                  rows={3}
                  placeholder="填写其他现场情况说明..."
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  disabled={!canEditCompletion}
                />
                {/* Remark Images Section */}
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {remarkImages.map((img, idx) => (
                        <div key={idx} className="relative w-16 h-16 group border border-slate-200 rounded-lg overflow-hidden">
                          <img src={img} alt={`附件 ${idx + 1}`} className="w-full h-full object-cover" />
                          {canEditCompletion && (
                            <button 
                                onClick={() => removeRemarkImage(idx)}
                                className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                      {canEditCompletion && (
                         <label className="w-16 h-16 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition-all">
                             <Plus size={20} />
                             <input type="file" accept="image/*" multiple className="hidden" onChange={handleRemarkImageAdd} />
                         </label>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">可上传多张补充图片(非强制)</p>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-slate-700">3. 现场拍照 (时间+地点水印) {canEditCompletion && <span className="text-red-500">*</span>}</label>
                  {canEditCompletion && photoData && (
                    <button 
                      onClick={verifyImageWithAI}
                      disabled={isVerifying}
                      className="text-xs flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full border border-indigo-200 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                      {isVerifying ? <span className="animate-pulse">AI 识别中...</span> : <><BrainCircuit size={14} /> 智能核对 (通义千问)</>}
                    </button>
                  )}
                </div>

                {canEditCompletion && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200">
                    <MapPin size={14} className={locationText && !locationText.includes('无法') ? "text-green-600" : "text-amber-500"} />
                    <span>{locationText || "正在获取当前位置..."}</span>
                  </div>
                )}
                
                <input type="file" accept="image/*" capture="environment" className="hidden" ref={nativeInputRef} onChange={handleNativeCameraCapture} />

                {canEditCompletion && !isCameraOpen && !photoData && (
                  <div className={`grid gap-4 ${currentUser.role === 'WORKER' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                     <Button onClick={startCamera} variant="outline" className="h-32 flex flex-col gap-2 border-dashed">
                       <Camera size={32} />
                       <span>打开网页相机</span>
                       {currentUser.role === 'WORKER' && <span className="text-[10px] text-slate-400">请使用实时拍照</span>}
                     </Button>
                     {currentUser.role !== 'WORKER' && (
                       <Button onClick={() => nativeInputRef.current?.click()} variant="outline" className="h-32 flex flex-col gap-2 border-dashed bg-slate-50 hover:bg-slate-100">
                         <Aperture size={32} className="text-blue-600" />
                         <span>调用系统相机</span>
                       </Button>
                     )}
                  </div>
                )}

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

                {photoData ? (
                  <div className="space-y-2">
                    <div className="relative group bg-slate-900 rounded-lg overflow-hidden h-64 flex items-center justify-center">
                      <img src={photoData} alt="Captured" className="max-h-full max-w-full object-contain" />
                      {canEditCompletion && (
                          <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center gap-2 transition-all">
                          <Button onClick={() => setPhotoData(null)} variant="secondary" className="text-xs">重拍</Button>
                          </div>
                      )}
                    </div>
                    {verificationResult && (
                      <div className={`p-3 rounded-lg text-sm flex items-start gap-2 border ${verificationResult.match ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                        {verificationResult.match ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <ScanLine size={18} className="shrink-0 mt-0.5" />}
                        <div>
                          <p className="font-bold">{verificationResult.match ? "匹配成功" : "匹配失败/未识别"}</p>
                          <p>{verificationResult.message}</p>
                          {!verificationResult.match && verificationResult.detected !== 'Error' && <p className="mt-1 text-xs opacity-80">识别结果: {verificationResult.detected}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                    !canEditCompletion && !isCameraOpen && <div className="p-4 bg-slate-100 text-slate-500 text-center rounded-lg text-sm">无照片</div>
                )}
                
                {cameraError && (
                    <div className="mt-2 text-sm text-red-500 bg-red-50 p-2 rounded flex flex-col gap-2">
                        <p>{cameraError}</p>
                        {currentUser.role !== 'WORKER' && (
                          <Button variant="outline" onClick={() => nativeInputRef.current?.click()} className="bg-white border-red-200 text-red-600">点击此处使用系统相机</Button>
                        )}
                    </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">4. 录音导入</label>
                <div className="flex items-center gap-3">
                  {canEditCompletion ? (
                    <label className="flex-1">
                        <input type="file" accept="audio/*" className="hidden" onChange={handleAudioImport} />
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
                  {canEditCompletion && audioData && <button onClick={() => setAudioData(null)} className="text-red-500 hover:text-red-700 p-2"><X size={18} /></button>}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 justify-end bg-slate-50 rounded-b-xl">
              <Button variant="outline" onClick={closeCompletionModal}>{canEditCompletion ? '取消' : '关闭'}</Button>
              {canEditCompletion && <Button onClick={submitCompletion} disabled={!returnReason || !photoData}>提交回单</Button>}
            </div>
          </div>
        </div>
      )}

      {/* --- Transfer Modal --- */}
      {transferTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">转派订单</h3>
            <p className="text-sm text-slate-500 mb-4">当前处理人: <span className="font-semibold text-slate-800">{transferTarget.currentName}</span></p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">转派给 (姓名)</label>
              <input autoFocus className="w-full p-2 border rounded" value={newOwnerName} onChange={e => setNewOwnerName(e.target.value)} placeholder="输入新姓名..." />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setTransferTarget(null)}>取消</Button>
              <Button onClick={confirmTransfer} disabled={!newOwnerName.trim()}>确认转派</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Deadline Edit Modal --- */}
      {deadlineEditTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <CalendarClock size={20} className="text-blue-600" />
                修改截止时间
            </h3>
            <p className="text-sm text-slate-500 mb-4">
                请设置新的任务截止时间。
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-slate-700">截止时间</label>
              <input 
                type="datetime-local" 
                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={newDeadlineDate} 
                onChange={e => setNewDeadlineDate(e.target.value)} 
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDeadlineEditTarget(null)}>取消</Button>
              <Button variant="secondary" onClick={() => { setNewDeadlineDate(''); handleSaveDeadline(); }} className="bg-red-50 text-red-600 hover:bg-red-100">清除限制</Button>
              <Button onClick={handleSaveDeadline}>保存修改</Button>
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

            <div className="flex flex-wrap gap-2">
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

                {/* District Filter */}
                <div className="relative">
                   <select 
                        value={districtFilter} 
                        onChange={handleDistrictChange}
                        className="appearance-none pl-8 pr-8 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                    >
                        <option value="ALL">全部区域</option>
                        {DISTRICTS.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                    <Map size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {/* Team Filter */}
                <div className="relative">
                    <select 
                        value={teamFilter} 
                        onChange={e => setTeamFilter(e.target.value)}
                        className="appearance-none pl-8 pr-8 py-2 border border-slate-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[150px] max-w-[200px]"
                    >
                        <option value="ALL">全部班组</option>
                        {availableTeamsForFilter.map(t => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                    <Users size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </div>
          </div>
          
          <div className="flex gap-3 w-full xl:w-auto mt-2 xl:mt-0">
             {currentUser.role === 'ADMIN' && (
                <Button variant="outline" onClick={onReset} className="flex-1 xl:flex-none whitespace-nowrap">
                  <RotateCcw size={16} className="mr-2" /> 导入新数据
                </Button>
             )}
             
             {onRefresh && (
                <Button variant="outline" onClick={handleManualRefresh} isLoading={isRefreshing} className="flex-1 xl:flex-none px-3 whitespace-nowrap" title="刷新数据">
                  <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? '' : '刷新'}
                </Button>
             )}

             {/* Settings Button (Simple) */}
             <Button variant="secondary" onClick={() => setShowSettings(true)} className="px-3" title="系统设置">
               <Settings size={18} />
             </Button>

             <Button onClick={handleExport} className="flex-1 xl:flex-none whitespace-nowrap" isLoading={isExporting}>
               <Download size={16} className="mr-2" /> 导出 Excel
             </Button>
          </div>
        </div>

        {/* Table/List */}
        <div className="flex-1 overflow-auto bg-slate-50 p-4">
          {filteredOrders.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOrders.map((order) => {
                const isExpired = order.deadline ? new Date() > new Date(order.deadline) : false;
                
                return (
                  <div 
                    key={order.id} 
                    className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all p-5 flex flex-col space-y-3 relative group 
                      ${order.status === 'RECEIVED' ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'}
                      ${isExpired ? 'opacity-80 bg-slate-50' : ''}
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
                      
                      {/* Deadline Display */}
                      <div className="flex justify-between items-center text-xs mt-1 pt-1 border-t border-slate-50 min-h-[24px]">
                        <span className="text-slate-500">截止</span>
                        <div className="flex items-center gap-1">
                            {order.deadline ? (
                                <span className={`font-medium ${isExpired ? 'text-red-600' : 'text-amber-600'}`}>
                                    {new Date(order.deadline).toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-slate-400 italic">无限制</span>
                            )}
                            {currentUser.role === 'ADMIN' && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); openDeadlineModal(order); }}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                    title="修改截止时间"
                                >
                                    <Edit2 size={12} />
                                </button>
                            )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <div className="bg-slate-50 p-2 rounded text-center border border-slate-100 mb-3">
                        <span className="text-xs text-slate-500 block uppercase tracking-wider mb-1">串码</span>
                        <span className="font-mono text-sm font-bold text-slate-700 break-all">{order.serialCode}</span>
                      </div>

                      {order.status === 'COMPLETED' && (
                         <div className="flex gap-2 mb-3 text-xs text-slate-500">
                            {order.completionPhoto && <span className="flex items-center"><ImageIcon size={12} className="mr-1"/>有照片</span>}
                            {order.completionAudio && <span className="flex items-center"><Mic size={12} className="mr-1"/>有录音</span>}
                         </div>
                      )}

                      <div className="flex gap-2">
                        {currentUser.role === 'WORKER' && (order.status === 'DISPATCHED' || order.status === 'PENDING') && (
                          <Button 
                            onClick={() => handleReceive(order)}
                            disabled={isExpired}
                            className="w-full text-xs py-1"
                            title={isExpired ? "已过截止时间，无法接收" : ""}
                          >
                            <CheckCircle2 size={14} className="mr-1" /> {isExpired ? '已截止' : '接收'}
                          </Button>
                        )}

                        {currentUser.role === 'WORKER' && order.status === 'RECEIVED' && (
                          <Button 
                            onClick={() => openCompletionModal(order)}
                            // 如果过期，进入查看模式（openCompletionModal内部逻辑会通过canEditCompletion禁止编辑）
                            className={`w-full text-xs py-1 ${isExpired ? '' : 'bg-green-600 hover:bg-green-700'}`}
                            variant={isExpired ? 'outline' : 'primary'}
                          >
                            <CheckSquare size={14} className="mr-1" /> 
                            {isExpired ? '查看详情 (已截止)' : '回单'}
                          </Button>
                        )}

                        {(currentUser.role === 'WORKER' || currentUser.role === 'ADMIN') && (order.status === 'COMPLETED' || order.status === 'RECEIVED') && (
                          <Button 
                            variant="outline"
                            onClick={() => openCompletionModal(order)}
                            className="w-full text-xs py-1"
                          >
                             {/* Allow viewing even if processing (RECEIVED) to check status manually if sync failed visually */}
                             {order.status === 'RECEIVED' ? (currentUser.role === 'ADMIN' ? '查看详情 (处理中)' : '处理中') : (currentUser.role === 'WORKER' ? (isExpired ? '查看详情 (已截止)' : '查看/修改') : '查看回单')}
                          </Button>
                        )}

                        {currentUser.role === 'ADMIN' && (
                            <div className="flex gap-2 w-full">
                              <Button 
                                variant="secondary"
                                onClick={() => openTransferModal(order)}
                                className="flex-1 text-xs py-1"
                              >
                                <ArrowRightLeft size={14} className="mr-1" /> 转派
                              </Button>
                            </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-full text-slate-400">
               <Search size={48} className="mb-4 opacity-20" />
               <p>
                 {currentUser.role === 'WORKER' 
                   ? `未找到属于 "${currentUser.name}" 的订单` 
                   : `未找到匹配 "${searchTerm}" 的订单`}
               </p>
               {(statusFilter !== 'ALL' || districtFilter !== 'ALL' || teamFilter !== 'ALL') && (
                   <p className="mt-2 text-xs text-slate-500">
                       (已应用筛选条件: {statusFilter !== 'ALL' ? '状态 ' : ''}{districtFilter !== 'ALL' ? '区域 ' : ''}{teamFilter !== 'ALL' ? '班组' : ''})
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