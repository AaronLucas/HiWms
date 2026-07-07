import { Router, Request, Response } from 'express';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';

const router = Router();
const supabase = createSupabaseClientFromEnv();

type DeviceType = 'PDA' | 'SCALE' | 'CONVEYOR' | 'PRINTER' | 'RFID_READER' | 'OTHER';
type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'ERROR';

interface DeviceInput {
  tenant_id: string;
  device_code: string;
  device_type: DeviceType;
  location_id?: string;
  ip_address?: string;
  metadata?: Record<string, any>;
}

interface HeartbeatInput {
  device_id: string;
  status: DeviceStatus;
  battery_level?: number;
  signal_strength?: number;
  metadata?: Record<string, any>;
}

/**
 * @swagger
 * /api/devices:
 *   post:
 *     summary: 注册设备
 *     tags: [Devices]
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const input: DeviceInput = {
      tenant_id: tenantId,
      device_code: req.body.device_code,
      device_type: req.body.device_type,
      location_id: req.body.location_id,
      ip_address: req.body.ip_address,
      metadata: req.body.metadata,
    };

    if (!input.device_code || !input.device_type) {
      return res.status(400).json({ error: 'Missing device_code or device_type' });
    }

    const { data, error } = await supabase
      .from('devices')
      .insert({
        tenant_id: input.tenant_id,
        device_code: input.device_code,
        device_type: input.device_type,
        current_location_id: input.location_id,
        ip_address: input.ip_address,
        metadata: input.metadata,
        is_active: true,
        last_heartbeat_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: 查询设备列表
 *     tags: [Devices]
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;
    const deviceType = req.query.device_type as DeviceType;
    const status = req.query.status as DeviceStatus;

    let query = supabase
      .from('devices')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (deviceType) query = query.eq('device_type', deviceType);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      data: data || [],
      pagination: { page, pageSize, total: count || 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   get:
 *     summary: 获取设备详情
 *     tags: [Devices]
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Device not found' });

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   patch:
 *     summary: 更新设备信息
 *     tags: [Devices]
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const updates: any = { updated_at: new Date().toISOString() };

    if (req.body.device_code) updates.device_code = req.body.device_code;
    if (req.body.device_type) updates.device_type = req.body.device_type;
    if (req.body.location_id) updates.current_location_id = req.body.location_id;
    if (req.body.ip_address) updates.ip_address = req.body.ip_address;
    if (req.body.status) updates.status = req.body.status;
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
    if (req.body.metadata) updates.metadata = req.body.metadata;

    const { data, error } = await supabase
      .from('devices')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices/{id}/heartbeat:
 *   post:
 *     summary: 设备心跳上报
 *     tags: [Devices]
 */
router.post('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const input: HeartbeatInput = {
      device_id: req.params.id,
      status: req.body.status || 'ONLINE',
      battery_level: req.body.battery_level,
      signal_strength: req.body.signal_strength,
      metadata: req.body.metadata,
    };

    const { data, error } = await supabase
      .from('devices')
      .update({
        status: input.status,
        battery_level: input.battery_level,
        signal_strength: input.signal_strength,
        last_heartbeat_at: new Date().toISOString(),
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices/{id}/command:
 *   post:
 *     summary: 下发指令到设备
 *     tags: [Devices]
 */
router.post('/:id/command', async (req: Request, res: Response) => {
  try {
    const command = {
      device_id: req.params.id,
      command_type: req.body.command_type, // 'PRINT_LABEL', 'WEIGHT', 'SCAN', 'MOVE', 'STOP'
      payload: req.body.payload,
      priority: req.body.priority || 'NORMAL', // 'HIGH', 'NORMAL', 'LOW'
      timeout_seconds: req.body.timeout_seconds || 30,
      issued_by: req.body.issued_by,
      issued_at: new Date().toISOString(),
      status: 'PENDING',
    };

    // 存储到设备指令表（需要先创建表）
    // 这里暂时写入 metadata 或单独表
    const { data, error } = await supabase
      .from('devices')
      .update({
        pending_command: command,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ data: { command_id: data.id, ...command } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/devices/{id}/command/result:
 *   post:
 *     summary: 设备回报指令执行结果
 *     tags: [Devices]
 */
router.post('/:id/command/result', async (req: Request, res: Response) => {
  try {
    const result = {
      command_id: req.body.command_id,
      success: req.body.success,
      result_data: req.body.result_data,
      error_message: req.body.error_message,
      completed_at: new Date().toISOString(),
    };

    // 更新指令状态
    const { data, error } = await supabase
      .from('devices')
      .update({
        last_command_result: result,
        pending_command: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;