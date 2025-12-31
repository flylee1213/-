export type OrderStatus = 'PENDING' | 'DISPATCHED' | 'RECEIVED' | 'COMPLETED';

export type ReturnReason = '家中无人无法上门' | '终端在现场使用' | '目标终端无法找到' | '其他';

export interface Order {
  id: string;
  taskName: string;
  businessNo: string;
  team: string;
  userName: string;
  serialCode: string;
  // New fields for workflow
  status: OrderStatus;
  receivedAt?: string;
  completedAt?: string;
  history: string[]; // Audit log
  
  // Deadline control
  deadline?: string | null; // ISO string

  // Completion details
  returnReason?: ReturnReason;
  completionRemark?: string;
  completionPhoto?: string; // Base64 string
  completionAudio?: string; // Base64 string or filename
}

export interface RawRow {
  [key: string]: string | number | null | undefined;
}

export interface ColumnMapping {
  taskName: string;
  businessNo: string;
  team: string;
  userName: string;
  serialCode: string;
}

export type ParsingStep = 'LOGIN' | 'UPLOAD' | 'MAPPING' | 'RESULTS';

export const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  taskName: '任务名称',
  businessNo: '业务号',
  team: '班组',
  userName: '姓名',
  serialCode: '串码',
};

export type UserRole = 'ADMIN' | 'WORKER';

export interface User {
  name: string;
  role: UserRole;
}