import React, { useState, useMemo } from 'react';
import { Button } from './Button';
import { User, UserRole } from '../types';
import { Shield, User as UserIcon, LogIn, Users, Map } from 'lucide-react';
import { TEAM_DATA, DISTRICTS } from '../data/teamData';

interface LoginScreenProps {
  onLogin: (user: User) => void;
  availableTeams?: string[]; // Legacy prop, can be ignored now or used for fallback
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [role, setRole] = useState<UserRole>('ADMIN');
  const [name, setName] = useState('');
  
  // Two-step selection state
  const [district, setDistrict] = useState('');
  const [team, setTeam] = useState('');

  // Get teams based on selected district
  const currentTeams = useMemo(() => {
    if (!district) return [];
    return TEAM_DATA[district] || [];
  }, [district]);

  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDistrict(e.target.value);
    setTeam(''); // Reset team when district changes
  };

  const handleLogin = () => {
    if (role === 'WORKER') {
        if (!district) {
            alert('请先选择所属区域');
            return;
        }
        if (!team) {
            alert('请选择您的班组');
            return;
        }
        if (!name.trim()) {
            alert('请输入您的姓名');
            return;
        }
    }
    onLogin({
      role,
      name: role === 'ADMIN' ? '管理员' : name.trim(),
      team: role === 'WORKER' ? team : undefined // Pass the specific team
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
            <div className="space-y-4 animate-in slide-in-from-top-2">
              
              {/* 1. District Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                    <Map size={16} /> 所属区域
                </label>
                <select 
                    value={district} 
                    onChange={handleDistrictChange}
                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                    <option value="" disabled>-- 请选择区域 --</option>
                    {DISTRICTS.map(d => (
                        <option key={d} value={d}>{d}</option>
                    ))}
                </select>
              </div>

              {/* 2. Team Selection (Dependent) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                    <Users size={16} /> 选择班组
                </label>
                <select 
                    value={team} 
                    onChange={e => setTeam(e.target.value)}
                    disabled={!district}
                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                    <option value="" disabled>
                        {district ? "-- 请选择班组 --" : "-- 请先选择区域 --"}
                    </option>
                    {currentTeams.map(t => (
                        <option key={t} value={t}>{t}</option>
                    ))}
                </select>
              </div>

              {/* 3. Name Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">您的姓名</label>
                <input
                    type="text"
                    placeholder="请输入姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">系统将匹配 “班组 + 姓名”</p>
              </div>
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