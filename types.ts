export type UserRole = 'ADMIN' | 'WORKER';

export interface User {
  role: UserRole;
  name: string;
  team?: string;
}

export type ParsingStep = 'LOGIN' | 'UPLOAD' | 'MAPPING' | 'RESULTS';

export interface ColumnMapping {
  taskName: string;
  businessNo: string;
  team: string;
  userName: string;
  serialCode: string;
}

export const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  taskName: '任务名称',
  businessNo: '业务号',
  team: '班组',
  userName: '姓名',
  serialCode: '串码',
};

export type OrderStatus = 'PENDING' | 'DISPATCHED' | 'RECEIVED' | 'COMPLETED';

export type ReturnReason = '家中无人无法上门' | '终端在现场使用' | '目标终端无法找到' | '其他';

export type AuditStatus = 'PASSED' | 'FAILED' | 'PENDING';

export interface Order {
  id: string;
  taskName: string;
  businessNo: string;
  team: string;
  userName: string;
  serialCode: string;
  status: OrderStatus;
  history: string[];
  deadline?: string | null;
  
  // Worker actions
  receivedAt?: string;
  completedAt?: string;
  returnReason?: ReturnReason;
  completionRemark?: string;
  remarkImages?: string[];
  completionPhoto?: string;
  completionAudio?: string;
  
  // Verification
  auditStatus?: AuditStatus;
}
