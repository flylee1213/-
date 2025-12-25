import React, { useState } from 'react';
import { Button } from './Button';
import { User, UserRole } from '../types';
import { Shield, User as UserIcon, LogIn } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [role, setRole] = useState<UserRole>('ADMIN');
  const [name, setName] = useState('');

  const handleLogin = () => {
    if (role === 'WORKER' && !name.trim()) {
      alert('请输入您的姓名以匹配订单');
      return;
    }
    onLogin({
      role,
      name: role === 'ADMIN' ? '管理员' : name.trim()
    });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
      <div className="bg-white p-8 rounded-xl shadow-lg border border-slate-200 w-full max-w-md">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900">欢迎使用订单系统</h2>
          <p className="text-slate-500 mt-2">请选择您的身份以继续</p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setRole('ADMIN')}
              className={`p-4 rounded-lg border-2 flex flex-col items-center gap-3 transition-all ${
                role === 'ADMIN' 
                  ? 'border-blue-600 bg-blue-50 text-blue-700' 
                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
              }`}
            >
              <Shield size={24} />
              <span className="font-semibold">管理员/派发</span>
            </button>
            <button
              onClick={() => setRole('WORKER')}
              className={`p-4 rounded-lg border-2 flex flex-col items-center gap-3 transition-all ${
                role === 'WORKER' 
                  ? 'border-blue-600 bg-blue-50 text-blue-700' 
                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
              }`}
            >
              <UserIcon size={24} />
              <span className="font-semibold">执行人员/接收</span>
            </button>
          </div>

          {role === 'WORKER' && (
            <div className="space-y-2 animate-in slide-in-from-top-2">
              <label className="block text-sm font-medium text-slate-700">您的姓名</label>
              <input
                type="text"
                placeholder="请输入姓名 (需与Excel中一致)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-slate-400">系统将根据姓名自动筛选您的订单</p>
            </div>
          )}

          <Button onClick={handleLogin} className="w-full py-3 text-lg">
            <LogIn size={18} className="mr-2" /> 进入系统
          </Button>
        </div>
      </div>
    </div>
  );
};