// 确保环境变量优先初始化
import './inject/env.js';

// 按原代码执行顺序加载各个独立闭包
import './inject/mining.js';
import './inject/clipboard.js';
import './inject/mainWorld.js';
import './inject/credentialGuard.js';
