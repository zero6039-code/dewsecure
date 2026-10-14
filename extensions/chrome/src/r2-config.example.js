/**
 * DewSecure R2 配置模板
 *
 * 使用方法：
 * 1. 复制此文件为 r2-config.js
 * 2. 填入你的 Cloudflare R2 凭证
 * 3. 权限要求：Object Read Only
 */

export const R2_CONFIG = {
    accountId: 'YOUR_ACCOUNT_ID',
    accessKeyId: 'YOUR_ACCESS_KEY_ID',
    secretAccessKey: 'YOUR_SECRET_ACCESS_KEY',
    bucket: 'dewsecure-models',
    presignedUrlExpiry: 60,
};
