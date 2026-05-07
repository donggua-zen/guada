#!/usr/bin/env python3
"""
测试脚本：输出 Hello World
"""
import sys
import json

def main():
    result = {
        "message": "Hello from test skill beta!",
        "args": sys.argv[1:] if len(sys.argv) > 1 else []
    }
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
