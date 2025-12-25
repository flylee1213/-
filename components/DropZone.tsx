import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';

interface DropZoneProps {
  onFileLoaded: (file: File) => void;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndLoad(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files.length > 0) {
      validateAndLoad(e.target.files[0]);
    }
  };

  const validateAndLoad = (file: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv'
    ];

    // Simple extension check as fallback
    const hasValidExtension = /\.(xlsx|xls|csv)$/i.test(file.name);

    if (validTypes.includes(file.type) || hasValidExtension) {
      onFileLoaded(file);
    } else {
      setError('请上传有效的 Excel (.xlsx, .xls) 或 CSV 文件。');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center transition-all duration-200 cursor-pointer
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          type="file"
          ref={inputRef}
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={handleInputChange}
        />
        
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
          {isDragging ? <FileSpreadsheet size={32} /> : <Upload size={32} />}
        </div>
        
        <h3 className="text-xl font-semibold text-slate-900 mb-2">
          {isDragging ? '松开以上传' : '上传 Excel 文件'}
        </h3>
        
        <p className="text-slate-500 text-center max-w-sm mb-6">
          将文件拖拽至此处，或点击浏览。支持格式：.xlsx, .xls
        </p>

        {error && (
          <div className="flex items-center text-red-600 bg-red-50 px-4 py-2 rounded-lg text-sm mt-4">
            <AlertCircle size={16} className="mr-2" />
            {error}
          </div>
        )}
      </div>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-sm text-slate-500">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100">
          <span className="font-semibold block text-slate-900 mb-1">1. 上传</span>
          选择您的数据文件
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100">
          <span className="font-semibold block text-slate-900 mb-1">2. 映射</span>
          匹配列与字段
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100">
          <span className="font-semibold block text-slate-900 mb-1">3. 导出</span>
          查看并复制结果
        </div>
      </div>
    </div>
  );
};