import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { WechatPluginConfig } from './config.ts';
export declare const name = "wechat-bridge";
export declare const inject: string[];
export declare const Config: Schema<WechatPluginConfig>;
export declare function apply(ctx: Context, config: WechatPluginConfig): void;
