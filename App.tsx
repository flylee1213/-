import React, { useState, useEffect } from 'react';
import { DropZone } from './components/DropZone';
import { MappingWizard } from './components/MappingWizard';
import { ResultsView } from './components/ResultsView';
import { LoginScreen } from './components/LoginScreen';
import { parseExcelFile, generateId } from './utils/excelUtils';
import { Order, ParsingStep, ColumnMapping, User } from './types';
import { Layout, LogOut, Cloud, CloudOff } from 'lucide-react';
import { supabase } from './supabaseClient';

const App: React.FC = () => {
  const [step, setStep] = useState<ParsingStep>('LOGIN');
  const [user, setUser] = useState<User | null>(null);
  
  const [rawData, setRawData] = useState<any[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // --- Supabase Integration ---

  // 1. Fetch Initial Data
  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching orders:', error);
      setIsOnline(false);
    } else {
      setOrders(data as Order[] || []);
      setIsOnline(true);
    }
    setLoading(false);
  };

  // 2. Real-time Subscription
  useEffect(() => {
    // Initial fetch
    fetchOrders();

    // Setup Realtime Listener
    const channel = supabase
      .channel('public:orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          console.log('Realtime update:', payload);
          // Simple strategy: Re-fetch all or update local state
          // For simplicity and correctness, handling specific events:
          if (payload.eventType === 'INSERT') {
            setOrders((prev) => [payload.new as Order, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setOrders((prev) => prev.map(o => o.id === payload.new.id ? payload.new as Order : o));
          } else if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter(o => o.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setIsOnline(true);
        if (status === 'CHANNEL_ERROR') setIsOnline(false);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // --- Actions ---

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    if (loggedInUser.role === 'WORKER') {
      setStep('RESULTS');
    } else {
      // Admin: If data exists go to results, else upload
      // Since we fetch async, orders might be empty initially, 
      // but usually Admin wants to see dashboard if data exists.
      setStep('RESULTS'); 
    }
  };

  const handleLogout = () => {
    setUser(null);
    setStep('LOGIN');
  };

  const handleFileLoaded = async (file: File) => {
    setLoading(true);
    try {
      const data = await parseExcelFile(file);
      if (data && data.length > 0) {
        const firstRow = data[0] as Array<string | number>;
        const potentialHeaders = firstRow.map(String);
        const cleanData = data.filter(row => row && row.length > 0);
        
        setHeaders(potentialHeaders);
        setRawData(cleanData);
        setStep('MAPPING');
      } else {
        alert('文件似乎是空的');
      }
    } catch (error) {
      console.error(error);
      alert('解析文件失败，请尝试其他文件。');
    } finally {
      setLoading(false);
    }
  };

  const handleMappingConfirm = async (mapping: ColumnMapping, deadline?: string) => {
    setLoading(true);
    const dataRows = rawData.slice(1);
    
    // Prepare objects for DB
    const newOrders: Order[] = dataRows.map((row): Order | null => {
      const getValue = (idxStr: string) => {
        const idx = parseInt(idxStr, 10);
        const val = row[idx];
        return val !== undefined && val !== null ? String(val).trim() : '';
      };

      const taskName = getValue(mapping.taskName);
      if (!taskName) return null;

      return {
        id: generateId(),
        taskName,
        businessNo: getValue(mapping.businessNo),
        team: getValue(mapping.team),
        userName: getValue(mapping.userName),
        serialCode: getValue(mapping.serialCode),
        status: 'DISPATCHED',
        history: [`管理员导入于 ${new Date().toLocaleString()}`],
        deadline: deadline, // Add deadline to order
        // DB columns match JSON keys exactly due to our quote strategy in SQL
      } as Order;
    }).filter((o): o is Order => o !== null);

    // Batch Insert to Supabase
    const { error } = await supabase.from('orders').insert(newOrders);

    if (error) {
      // Offline/Error Fallback
      console.warn("Supabase insert failed, falling back to local state:", error);
      setOrders(prev => [...newOrders, ...prev]);
      alert(`注意：云端同步失败（${error.message || '未知错误'}）。已切换至本地演示模式，仅在当前浏览器会话有效。`);
      setStep('RESULTS');
    } else {
      alert(`成功导入 ${newOrders.length} 条订单！` + (deadline ? ` 截止时间: ${new Date(deadline).toLocaleString()}` : ''));
      setStep('RESULTS');
    }
    setLoading(false);
  };

  const handleOrderUpdate = async (orderId: string, updates: Partial<Order>) => {
    // Optimistic Update (update UI immediately)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));

    // Send to DB
    const { error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId);

    if (error) {
      console.error('Update failed:', JSON.stringify(error, null, 2));
      // Suppress alert for better UX in demo mode
      // alert('同步到服务器失败，请检查网络。');
    }
  };

  const resetToUpload = () => {
    if (user?.role === 'ADMIN') {
      setStep('UPLOAD');
      setRawData([]);
      setHeaders([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <Layout size={20} />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-blue-500">
              Excel 订单系统 (云端版)
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Connection Status Indicator */}
            <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isOnline ? <Cloud size={14} /> : <CloudOff size={14} />}
              <span className="hidden sm:inline">{isOnline ? '已连接云端' : '离线模式'}</span>
            </div>

            {user && (
              <div className="text-sm text-slate-600 hidden sm:flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full">
                <div className={`w-2 h-2 rounded-full ${user.role === 'ADMIN' ? 'bg-purple-500' : 'bg-green-500'}`}></div>
                <span className="font-semibold">{user.name}</span>
              </div>
            )}
            
            {step !== 'LOGIN' && (
              <button 
                onClick={handleLogout}
                className="text-slate-500 hover:text-red-600 transition-colors"
                title="退出登录"
              >
                <LogOut size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
           <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
             <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
             <p className="mt-4 text-blue-600 font-medium">正在处理数据...</p>
           </div>
        )}

        {/* Connection Warning */}
        {!isOnline && !loading && (
           <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-center text-sm">
             注意：无法连接到服务器。系统将以离线模式运行，数据刷新后可能丢失。
           </div>
        )}

        {step === 'LOGIN' && (
          <LoginScreen onLogin={handleLogin} />
        )}

        {step === 'UPLOAD' && user?.role === 'ADMIN' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
             <div className="text-center mb-8 max-w-lg">
                <h2 className="text-3xl font-bold text-slate-900 mb-4">导入并派发订单</h2>
                <p className="text-slate-600">
                  上传 Excel 文件，系统将自动识别并拆分：<br/>
                  <b>任务名称、业务号、班组、姓名、串码</b>
                </p>
             </div>
             <DropZone onFileLoaded={handleFileLoaded} />
             {orders.length > 0 && (
               <button onClick={() => setStep('RESULTS')} className="mt-8 text-blue-600 hover:underline">
                 跳过上传，查看现有 {orders.length} 个订单 &rarr;
               </button>
             )}
          </div>
        )}

        {step === 'MAPPING' && (
          <div className="animate-in slide-in-from-right-10 duration-500">
             <MappingWizard 
               headers={headers} 
               previewData={rawData.slice(1, 6)} 
               onConfirm={handleMappingConfirm}
               onCancel={resetToUpload}
             />
          </div>
        )}

        {step === 'RESULTS' && user && (
          <div className="animate-in slide-in-from-bottom-10 duration-500">
            <ResultsView 
              orders={orders} 
              currentUser={user}
              onReset={resetToUpload} 
              onUpdateOrder={handleOrderUpdate}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;