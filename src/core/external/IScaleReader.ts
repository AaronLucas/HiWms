/**
 * 电子秤读数端口接口
 * 称重设备抽象
 */
export interface IScaleReader {
  /**
   * 读取当前重量
   */
  readWeight(): Promise<{
    /** 重量值（克） */
    weight: number;
    /** 单位 */
    unit: 'g' | 'kg';
    /** 是否稳定 */
    stable: boolean;
    /** 时间戳 */
    timestamp: Date;
  }>;

  /**
   * 去皮
   */
  tare(): Promise<void>;

  /**
   * 校准
   */
  calibrate(knownWeight: number): Promise<boolean>;

  /**
   * 获取设备状态
   */
  getStatus(): Promise<{
    connected: boolean;
    model?: string;
    lastCalibration?: Date;
  }>;
}