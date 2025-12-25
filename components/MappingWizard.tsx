import React, { useState, useEffect } from 'react';
import { ColumnMapping, FIELD_LABELS } from '../types';
import { Button } from './Button';
import { ArrowRight, FileSpreadsheet, RotateCcw } from 'lucide-react';

interface MappingWizardProps {
  headers: string[];
  previewData: any[][];
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

export const MappingWizard: React.FC<MappingWizardProps> = ({ headers, previewData, onConfirm, onCancel }) => {
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  
  // Auto-detection logic
  useEffect(() => {
    const newMapping: Partial<ColumnMapping> = {};
    headers.forEach((header, index) => {
      const h = header.toString().toLowerCase();
      if (h.includes('任务') || h.includes('task')) newMapping.taskName = index.toString();
      if (h.includes('业务') || h.includes('business')) newMapping.businessNo = index.toString();
      if (h.includes('班组') || h.includes('team')) newMapping.team = index.toString();
      if (h.includes('姓名') || h.includes('name')) newMapping.userName = index.toString();
      if (h.includes('串码') || h.includes('serial') || h.includes('code')) newMapping.serialCode = index.toString();
    });
    setMapping(prev => ({ ...prev, ...newMapping }));
  }, [headers]);

  const handleChange = (field: keyof ColumnMapping, value: string) => {
    setMapping(prev => ({ ...prev, [field]: value }));
  };

  const isComplete = 
    mapping.taskName !== undefined && 
    mapping.businessNo !== undefined && 
    mapping.team !== undefined && 
    mapping.userName !== undefined && 
    mapping.serialCode !== undefined;

  return (
    <div className="w-full max-w-5xl mx-auto bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="text-blue-600" size={24} />
            列映射
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            请选择 Excel 文件中各列对应的字段。
          </p>
        </div>
        <Button variant="outline" onClick={onCancel} className="flex items-center gap-2">
          <RotateCcw size={16} /> 重新开始
        </Button>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Mapping Controls */}
        <div className="lg:col-span-1 space-y-5">
          {Object.entries(FIELD_LABELS).map(([key, label]) => (
            <div key={key} className="bg-slate-50 p-4 rounded-lg border border-slate-100">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                {label} <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full p-2.5 bg-white border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                value={mapping[key as keyof ColumnMapping] || ''}
                onChange={(e) => handleChange(key as keyof ColumnMapping, e.target.value)}
              >
                <option value="" disabled>-- 选择列 --</option>
                {headers.map((h, idx) => (
                  <option key={idx} value={idx.toString()}>
                    {`列 ${String.fromCharCode(65 + idx)}: ${h || '(空标题)'}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
          
          <div className="pt-4">
             <Button 
                onClick={() => isComplete && onConfirm(mapping as ColumnMapping)}
                disabled={!isComplete}
                className="w-full justify-center py-3 text-base"
             >
                生成订单 <ArrowRight size={18} className="ml-2" />
             </Button>
             {!isComplete && (
               <p className="text-xs text-center text-amber-600 mt-2">
                 请映射所有 5 个字段以继续。
               </p>
             )}
          </div>
        </div>

        {/* Right: Data Preview */}
        <div className="lg:col-span-2 flex flex-col h-full min-h-[500px]">
           <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-700">数据预览 (前 5 行)</h3>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">仅预览</span>
           </div>
           <div className="flex-1 border border-slate-200 rounded-lg overflow-auto bg-slate-50">
             <table className="w-full text-sm text-left text-slate-600 whitespace-nowrap">
               <thead className="text-xs text-slate-700 uppercase bg-slate-200 sticky top-0">
                 <tr>
                   {headers.map((h, i) => (
                     <th key={i} className="px-4 py-3 border-b border-slate-300 font-bold min-w-[120px]">
                       <div className="flex flex-col">
                         <span className="text-slate-500 text-[10px] mb-1">列 {String.fromCharCode(65 + i)}</span>
                         <span>{h || `(索引 ${i})`}</span>
                       </div>
                     </th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {previewData.map((row, rIdx) => (
                   <tr key={rIdx} className="bg-white border-b hover:bg-slate-50">
                     {headers.map((_, cIdx) => (
                       <td key={cIdx} className="px-4 py-3 border-slate-100">
                         {row[cIdx] !== undefined ? String(row[cIdx]) : <span className="text-slate-300 italic">空</span>}
                       </td>
                     ))}
                   </tr>
                 ))}
                 {previewData.length === 0 && (
                   <tr>
                     <td colSpan={headers.length} className="p-8 text-center text-slate-400">
                       未找到可预览的数据。
                     </td>
                   </tr>
                 )}
               </tbody>
             </table>
           </div>
           <p className="text-xs text-slate-400 mt-2">
             * 仅显示部分预览。确认后将处理完整文件。
           </p>
        </div>
      </div>
    </div>
  );
};