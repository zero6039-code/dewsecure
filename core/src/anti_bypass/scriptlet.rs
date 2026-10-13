//! Scriptlet 变异引擎
//!
//! 生成动态变异的 JavaScript 代码，绕过反拦截检测。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Scriptlet 类型
#[derive(Debug, Clone, Copy)]
pub enum ScriptletType {
    /// 空操作
    Noop,
    /// 隐藏元素
    Hide,
    /// 覆盖函数
    Override,
    /// 模拟环境
    Simulate,
}

/// 生成变异的 Scriptlet
pub fn generate_scriptlet(script_type: ScriptletType, seed: u64) -> String {
    let var_name = generate_var_name(seed, 0);
    let fn_name = generate_var_name(seed, 1);
    let arg_name = generate_var_name(seed, 2);

    match script_type {
        ScriptletType::Noop => {
            format!("const {var} = function() {{ return ''; }};", var = var_name)
        }
        ScriptletType::Hide => {
            format!(
                r#"(function() {{
    const {fn_name} = function({arg_name}) {{
        const elements = document.querySelectorAll({arg_name});
        for (let i = 0; i < elements.length; i++) {{
            elements[i].style.setProperty('display', 'none', 'important');
            elements[i].style.setProperty('visibility', 'hidden', 'important');
            elements[i].style.setProperty('opacity', '0', 'important');
        }}
    }};
    window.{fn_name} = {fn_name};
}})();"#,
                fn_name = fn_name,
                arg_name = arg_name
            )
        }
        ScriptletType::Override => {
            format!(
                r#"(function() {{
    const {var} = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function(obj, prop) {{
        if (prop === 'adBlock' || prop === 'adblock' || prop === 'adsBlocked') {{
            return undefined;
        }}
        return {var}.call(this, obj, prop);
    }};
}})();"#,
                var = var_name
            )
        }
        ScriptletType::Simulate => {
            format!(
                r#"(function() {{
    const {fn_name} = function() {{
        return {{
            adBlock: false,
            adblock: false,
            adsBlocked: 0,
            isAdBlockActive: false,
            canRunAds: true,
            canShowAds: true
        }};
    }};
    Object.defineProperty(window, 'google_ad_status', {{
        get: {fn_name},
        configurable: false
    }});
}})();"#,
                fn_name = fn_name
            )
        }
    }
}

/// 生成完整的反反拦截脚本
pub fn generate_anti_bypass_script(seed: u64) -> String {
    let scriptlets = [
        ScriptletType::Noop,
        ScriptletType::Override,
        ScriptletType::Simulate,
    ];

    let mut script = String::from("(function() {\n");
    script.push_str("'use strict';\n");

    // 模拟常见检测变量
    let detection_vars = [
        "adBlock",
        "adblock",
        "adsBlocked",
        "isAdBlockActive",
        "canRunAds",
        "canShowAds",
        "adblockDetected",
        "isAdblockActive",
    ];

    let obj_name = generate_var_name(seed, 100);
    script.push_str(&format!("const {} = {{\n", obj_name));
    for (i, var) in detection_vars.iter().enumerate() {
        let value = if i % 2 == 0 { "false" } else { "0" };
        script.push_str(&format!("    {}: {},\n", var, value));
    }
    script.push_str("};\n");

    // 覆盖全局检测
    for var in &detection_vars {
        script.push_str(&format!(
            "try {{ Object.defineProperty(window, '{}', {{ get: function() {{ return {}['{}']; }}, configurable: true }}); }} catch(e) {{}}\n",
            var, obj_name, var
        ));
    }

    // 添加 Scriptlet 变异
    for (i, st) in scriptlets.iter().enumerate() {
        let s = generate_scriptlet(*st, seed + i as u64);
        script.push_str(&s);
        script.push('\n');
    }

    script.push_str("})();\n");
    script
}

/// 基于种子生成变量名
fn generate_var_name(seed: u64, index: u64) -> String {
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    index.hash(&mut hasher);
    let hash = hasher.finish();

    format!("_0x{:x}", hash & 0xFFFFFFFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_scriptlet() {
        let s1 = generate_scriptlet(ScriptletType::Noop, 12345);
        let s2 = generate_scriptlet(ScriptletType::Noop, 67890);
        // 不同种子应该生成不同的变量名
        assert_ne!(s1, s2);
    }

    #[test]
    fn test_anti_bypass_script() {
        let script = generate_anti_bypass_script(42);
        assert!(script.contains("adBlock"));
        assert!(script.contains("Object.defineProperty"));
    }
}
