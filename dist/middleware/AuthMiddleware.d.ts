import { Request, Response, NextFunction } from 'express';
import { RoleManager } from '../services/RoleManager';
export declare class AuthMiddleware {
    private roleManager;
    private supabaseUrl;
    private supabaseAnonKey;
    constructor(roleManager: RoleManager, env: {
        SUPABASE_URL: string;
        SUPABASE_ANON_KEY: string;
    });
    /**
     * Express 中间件：认证与授权拦截
     */
    handle: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}
