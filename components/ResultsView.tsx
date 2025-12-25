import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Order, User, OrderStatus, ReturnReason } from '../types';
import { Button } from './Button';
import { Download, Search, RotateCcw, CheckCircle2, UserCircle, ArrowRightLeft, CheckSquare, Camera, Mic, X, Image as ImageIcon, Aperture } from 'lucide-react';
import ExcelJS from 'exceljs';

interface ResultsViewProps {
  orders: Order[];
  currentUser: User;
  onReset: () => void;
  onUpdateOrder: (orderId: string, updates: Partial<Order>) => void;
}

export const ResultsView: React.FC<ResultsViewProps> = ({ orders, currentUser, onReset, onUpdateOrder }) => {
  const [searchTerm, setSearchTerm] = useState('');
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

  const filteredOrders = useMemo(() => {
    const lowerTerm = searchTerm.toLowerCase().trim();
    
    // Filter by User Identity
    let visibleOrders = orders;
    if (currentUser.role === 'WORKER') {
      visibleOrders = orders.filter(o => o.userName === currentUser.name);
    }

    if (!lowerTerm) return visibleOrders;

    // Filter by Search
    const results = visibleOrders.filter(order => 
      Object.values(order).some(val => 
        String(val).toLowerCase().includes(lowerTerm)
      )
    );

    // Sort
    return results.sort((a, b) => {
      const aTask = a.taskName.toLowerCase();
      const bTask = b.taskName.toLowerCase();
      if (aTask === lowerTerm && bTask !== lowerTerm) return -1;
      if (bTask === lowerTerm && aTask !== lowerTerm) return 1;
      return 0;
    });
  }, [orders, searchTerm, currentUser]);

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
      // Don't close camera state immediately, show error and option to use system camera
      setCameraError("无法访问网页相机 (可能是权限或HTTPS问题)。请尝试下方“调用系统相机”按钮。");
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

    onUpdateOrder(completionTarget.id, {
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      returnReason: returnReason as ReturnReason,
      completionRemark: remark,
      completionPhoto: photoData || undefined,
      completionAudio: audioData?.data || undefined,
      history: [...currentHistory, `${currentUser.name} 于 ${new Date().toLocaleString()} 完成回单`]
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
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  3. 现场拍照 (带时间水印)
                </label>
                
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
                  <div className="grid grid-cols-2 gap-4">
                     {/* Standard Web Camera */}
                     <Button onClick={startCamera} variant="outline" className="h-32 flex flex-col gap-2 border-dashed">
                       <Camera size={32} />
                       <span>打开网页相机</span>
                     </Button>
                     {/* Native Camera (Fallback) */}
                     <Button onClick={() => nativeInputRef.current?.click()} variant="outline" className="h-32 flex flex-col gap-2 border-dashed bg-slate-50 hover:bg-slate-100">
                       <Aperture size={32} className="text-blue-600" />
                       <span>调用系统相机</span>
                       <span className="text-[10px] text-slate-400">推荐(兼容性好)</span>
                     </Button>
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

                {/* Photo Display - Show if photo exists (editing or viewing) */}
                {photoData ? (
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
                ) : (
                    !canEditCompletion && !isCameraOpen && (
                        <div className="p-4 bg-slate-100 text-slate-500 text-center rounded-lg text-sm">
                            无照片
                        </div>
                    )
                )}
                {/* Show Camera Error but offer Native fallback */}
                {cameraError && (
                    <div className="mt-2 text-sm text-red-500 bg-red-50 p-2 rounded flex flex-col gap-2">
                        <p>{cameraError}</p>
                        <Button 
                            variant="outline" 
                            onClick={() => nativeInputRef.current?.click()}
                            className="bg-white border-red-200 text-red-600"
                        >
                            点击此处使用系统相机
                        </Button>
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
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50">
          <div className="relative w-full md:w-96">
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
          
          <div className="flex gap-3 w-full md:w-auto">
             {currentUser.role === 'ADMIN' && (
                <Button variant="outline" onClick={onReset} className="flex-1 md:flex-none">
                  <RotateCcw size={16} className="mr-2" /> 导入新数据
                </Button>
             )}
             <Button onClick={handleExport} className="flex-1 md:flex-none" isLoading={isExporting}>
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