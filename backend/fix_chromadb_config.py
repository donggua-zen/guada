"""
修复 ChromaDB 配置冲突问题

问题：An instance of Chroma already exists for ./data/chroma_db with different settings
原因：之前使用了不同的 Settings 配置创建了实例
解决：删除旧的配置缓存，使用新配置重新创建
"""

import os
import shutil
from pathlib import Path

def fix_chromadb_config_conflict():
    """修复 ChromaDB 配置冲突"""
    
    chroma_dir = Path("./data/chroma_db")
    
    if not chroma_dir.exists():
        print(f"✓ ChromaDB 目录不存在：{chroma_dir}")
        print("  无需修复，首次运行时会自动创建")
        return
    
    # 需要删除的配置文件
    files_to_remove = [
        chroma_dir / "chroma.sqlite3",  # 主数据库文件
        chroma_dir / "*.lock",          # 锁文件（如果有）
    ]
    
    print(f"📁 ChromaDB 目录：{chroma_dir.absolute()}")
    print(f"📊 当前文件大小：{sum(f.stat().st_size for f in chroma_dir.glob('*') if f.is_file()) / 1024:.2f} KB")
    
    # 备份重要数据（如果存在）
    backup_dir = Path("./data/chroma_db_backup")
    if not backup_dir.exists() and chroma_dir.exists():
        print(f"\n 建议先备份数据")
        print(f"   可以手动复制 {chroma_dir} 到安全位置")
        
        response = input("\n是否继续？这将删除现有的 ChromaDB 数据 (y/N): ")
        if response.lower() != 'y':
            print("❌ 已取消")
            return
    
    # 删除配置文件
    deleted_count = 0
    for file_path in files_to_remove:
        if file_path.exists():
            try:
                if '*' in str(file_path):
                    # 处理通配符
                    for f in chroma_dir.glob(file_path.name):
                        f.unlink()
                        deleted_count += 1
                        print(f"删除：{f}")
                else:
                    file_path.unlink()
                    deleted_count += 1
                    print(f"删除：{file_path}")
            except Exception as e:
                print(f"❌ 删除失败 {file_path}: {e}")
    
    print(f"\n修复完成！共删除 {deleted_count} 个文件")
    print("\n下一步:")
    print("1. 重启后端服务：python run.py")
    print("2. 观察日志：应该看到 'ChromaDB 客户端已初始化'")
    print("3. 上传测试文件验证功能正常")


if __name__ == "__main__":
    fix_chromadb_config_conflict()
