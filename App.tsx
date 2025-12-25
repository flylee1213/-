import React, { useState, useEffect } from 'react';
import { DropZone } from './components/DropZone';
import { MappingWizard } from './components/MappingWizard';
import { ResultsView } from './components/ResultsView';
import { LoginScreen } from './components/LoginScreen';
import { parseExcelFile, generateId } from './utils/excelUtils';
import { Order, ParsingStep, ColumnMapping, User } from './types';
import { Layout, LogOut } from 'lucide-react';

const STORAGE_KEY = 'excel_parser_orders';

const App: React.FC = () => {
  const [step, setStep] = useState<ParsingStep>('LOGIN');
  const [user, setUser] = useState<User | null>(null);
  
  const [rawData, setRawData] = useState<any[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  // Load orders from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setOrders(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved orders", e);
      }
    }
  }, []);

  // Save orders whenever they change
  const saveOrders = (newOrders: Order[]) => {
    setOrders(newOrders);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrders));
  };

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    
    if (loggedInUser.role === 'WORKER') {
      // Worker goes straight to results to see existing data
      setStep('RESULTS');
    } else {
      // Admin goes to Upload to add more data, or can view results if data exists
      setStep(orders.length > 0 ? 'RESULTS' : 'UPLOAD');
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

  const handleMappingConfirm = (mapping: ColumnMapping) => {
    const dataRows = rawData.slice(1);
    
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
        // Default Status for new imports
        status: 'DISPATCHED', // Auto-dispatch upon import
        history: [`管理员导入于 ${new Date().toLocaleString()}`],
        receivedAt: undefined,
        completedAt: undefined,
      };
    }).filter((o): o is Order => o !== null);

    // Merge with existing orders (or replace? Here we append)
    const updatedOrders = [...orders, ...newOrders];
    saveOrders(updatedOrders);
    setStep('RESULTS');
  };

  const handleOrderUpdate = (orderId: string, updates: Partial<Order>) => {
    const updatedOrders = orders.map(o => 
      o.id === orderId ? { ...o, ...updates } : o
    );
    saveOrders(updatedOrders);
  };

  const resetToUpload = () => {
    // Only Admin can upload
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
              Excel 订单系统
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {user && (
              <div className="text-sm text-slate-600 hidden sm:flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full">
                <div className={`w-2 h-2 rounded-full ${user.role === 'ADMIN' ? 'bg-purple-500' : 'bg-green-500'}`}></div>
                <span className="font-semibold">{user.name}</span>
                <span className="text-xs opacity-75">({user.role === 'ADMIN' ? '管理员' : '员工'})</span>
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
             <p className="mt-4 text-blue-600 font-medium">正在处理...</p>
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
                  上传 Excel 文件，系统将自动根据“姓名”列将订单派发给对应人员。
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