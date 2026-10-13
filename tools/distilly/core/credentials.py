"""
采集器凭证读取

目标：App Secret、user_access_token、Bot Token 等凭证永远不经过 AI 代理的对话上下文。

读取优先级（高 → 低）：
  1. 环境变量（例如 FEISHU_APP_SECRET）
  2. 系统钥匙串（需安装可选依赖 keyring：pip3 install keyring）
  3. 本地配置文件 ~/.distilly/*_config.json（权限 0600）

写入只发生在用户自己终端里运行的 --setup / --login：密钥用 getpass 隐藏输入，
优先写入系统钥匙串，没有 keyring 时写入 0600 配置文件。采集器从不打印凭证内容，
--check 只报告每个字段「是否已配置、来自哪里」。
"""

from __future__ import annotations

import getpass
import os
import sys
from typing import Callable, Optional


KEYRING_SERVICE = "distilly"
SECRET_STORE_KEY = "secret_store"

# 平台 → {配置字段: 环境变量名}。环境变量名同时用作钥匙串里的条目名，
# 所以飞书自动采集器和飞书 MCP 客户端共用同一份钥匙串凭证。
FIELDS: dict[str, dict[str, str]] = {
    "feishu": {
        "app_id": "FEISHU_APP_ID",
        "app_secret": "FEISHU_APP_SECRET",
        "user_access_token": "FEISHU_USER_ACCESS_TOKEN",
        "refresh_token": "FEISHU_REFRESH_TOKEN",
    },
    "feishu_mcp": {
        "app_id": "FEISHU_APP_ID",
        "app_secret": "FEISHU_APP_SECRET",
        "user_token": "FEISHU_USER_ACCESS_TOKEN",
    },
    "dingtalk": {
        "app_key": "DINGTALK_APP_KEY",
        "app_secret": "DINGTALK_APP_SECRET",
    },
    "slack": {
        "bot_token": "SLACK_BOT_TOKEN",
    },
}

SECRET_FIELDS = {"app_secret", "user_access_token", "refresh_token", "user_token", "bot_token"}

AGENT_WARNING = (
    "请在你自己的终端里运行这条命令，不要让 AI 代理代为运行，也不要把密钥粘贴到对话里。\n"
    "不想交互输入的话，也可以直接设置环境变量：{env_vars}"
)


# ─── 钥匙串（可选）──────────────────────────────────────────────────────────────

def _keyring():
    try:
        import keyring  # type: ignore
    except ImportError:
        return None
    return keyring


def keyring_available() -> bool:
    return _keyring() is not None


def _keyring_get(env_name: str) -> Optional[str]:
    kr = _keyring()
    if kr is None:
        return None
    try:
        return kr.get_password(KEYRING_SERVICE, env_name) or None
    except Exception:
        return None


def _keyring_set(env_name: str, value: str) -> bool:
    kr = _keyring()
    if kr is None:
        return False
    try:
        kr.set_password(KEYRING_SERVICE, env_name, value)
        return True
    except Exception as exc:
        print(f"⚠️  写入系统钥匙串失败（{type(exc).__name__}），改为写入本地配置文件", file=sys.stderr)
        return False


# ─── 读取 ──────────────────────────────────────────────────────────────────────

def _lookup(platform: str, field: str, raw: dict) -> tuple[Optional[str], str]:
    env_name = FIELDS[platform][field]
    value = os.environ.get(env_name, "").strip()
    if value:
        return value, f"环境变量 {env_name}"
    if field in SECRET_FIELDS:
        value = _keyring_get(env_name)
        if value:
            return value, "系统钥匙串"
    value = raw.get(field)
    if value:
        return value, "配置文件"
    return None, "未配置"


def resolve(platform: str, raw: dict) -> dict:
    """返回运行时配置：raw 配置文件内容 + 钥匙串 + 环境变量覆盖。

    返回值只在内存里使用，不要再写回配置文件；写入请用 save_secrets。
    """
    config = {k: v for k, v in raw.items() if k != SECRET_STORE_KEY}
    for field in FIELDS[platform]:
        value, _ = _lookup(platform, field, raw)
        if value:
            config[field] = value
    return config


def describe(platform: str, raw: dict) -> str:
    """凭证状态报告：只说明每个字段是否已配置、来源是哪里，从不输出值。"""
    lines = []
    for field, env_name in FIELDS[platform].items():
        _, source = _lookup(platform, field, raw)
        mark = "✅" if source != "未配置" else "—"
        lines.append(f"  {mark} {field:<18} {source}  （环境变量名：{env_name}）")
    return "\n".join(lines)


def require(platform: str, config: dict, fields: list[str], setup_cmd: str) -> None:
    missing = [f for f in fields if not config.get(f)]
    if not missing:
        return
    env_vars = ", ".join(FIELDS[platform][f] for f in missing)
    print(f"缺少凭证：{', '.join(missing)}", file=sys.stderr)
    print(f"请在你自己的终端运行：{setup_cmd}", file=sys.stderr)
    print(f"或设置环境变量：{env_vars}", file=sys.stderr)
    print("不要把这些值粘贴到 AI 对话里。", file=sys.stderr)
    sys.exit(1)


# ─── 写入（只在用户终端里交互使用）─────────────────────────────────────────────────

def ensure_interactive(platform: str) -> None:
    """--setup / --login 只允许在真实终端里运行，避免代理通过管道把密钥带进上下文。"""
    if sys.stdin.isatty():
        return
    env_vars = ", ".join(dict.fromkeys(FIELDS[platform].values()))
    print("错误：此命令需要在交互式终端中运行。", file=sys.stderr)
    print(AGENT_WARNING.format(env_vars=env_vars), file=sys.stderr)
    sys.exit(2)


def ask(label: str) -> str:
    return input(f"{label}: ").strip()


def ask_secret(label: str) -> str:
    """隐藏输入，不回显，也不会出现在 shell history 或命令参数里。"""
    return getpass.getpass(f"{label}（输入不显示）: ").strip()


def choose_store(raw: dict) -> None:
    """有 keyring 时询问是否把密钥存进系统钥匙串，选择结果记在配置文件里。"""
    if not keyring_available():
        raw.pop(SECRET_STORE_KEY, None)
        print("提示：安装 keyring（pip3 install keyring）后可把密钥存进系统钥匙串；当前写入 0600 配置文件。")
        return
    answer = input("把密钥保存到系统钥匙串？[Y/n]: ").strip().lower()
    if answer in ("", "y", "yes"):
        raw[SECRET_STORE_KEY] = "keyring"
    else:
        raw.pop(SECRET_STORE_KEY, None)


def save_secrets(
    platform: str,
    raw: dict,
    values: dict,
    save_config: Callable[[dict], None],
) -> None:
    """把凭证写入钥匙串或配置文件，并保存配置文件。

    raw 必须是配置文件原始内容（load_config 的返回值），不是 resolve 的结果，
    否则会把来自环境变量的密钥写进磁盘。
    """
    use_keyring = raw.get(SECRET_STORE_KEY) == "keyring"
    for field, value in values.items():
        if field not in FIELDS[platform]:
            raw[field] = value
            continue
        if not value:
            raw.pop(field, None)
            continue
        if field in SECRET_FIELDS and use_keyring and _keyring_set(FIELDS[platform][field], value):
            raw.pop(field, None)
        else:
            raw[field] = value
    save_config(raw)
