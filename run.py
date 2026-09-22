#!/usr/bin/env python3
"""
실시간 밸런스 게임 로컬 실행 서버 (run.py)
외부 의존성 설치 없이 Python 기본 내장 라이브러리로 즉시 구동됩니다.
"""

import os
import sys
import webbrowser
import socket
from http.server import HTTPServer, SimpleHTTPRequestHandler

class CustomHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # UTF-8 인코딩 및 CORS 헤더
        if self.path.endswith('.html') or self.path == '/':
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        elif self.path.endswith('.js'):
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        elif self.path.endswith('.css'):
            self.send_header('Content-Type', 'text/css; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def get_free_port(default_port=8000):
    """사용 가능한 포트를 확인하고 반환합니다."""
    port = default_port
    while port < default_port + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
            port += 1
    return default_port

def start_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = get_free_port(8000)
    server_address = ('', port)

    httpd = HTTPServer(server_address, CustomHTTPRequestHandler)

    print("=" * 60)
    print(" ⚖️  실시간 밸런스 게임 로컬 서버가 시작되었습니다! ")
    print("=" * 60)
    print(f" 👤 참가자 화면 (Participant) : http://localhost:{port}/")
    print(f" 👑 진행자 콘솔 (Host)        : http://localhost:{port}/host.html")
    print("-" * 60)
    print(" [안내] Firebase 연동(balance-efed2)이 완료되었습니다.")
    print(" 서버를 종료하려면 터미널 창을 닫거나 Ctrl + C 를 누르세요.")
    print("=" * 60)

    try:
        webbrowser.open(f"http://localhost:{port}/host.html")
        webbrowser.open(f"http://localhost:{port}/")
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 안전하게 종료했습니다.")
        httpd.server_close()

def main():
    try:
        start_server()
    except Exception as e:
        print(f"\n[오류 발생] {e}")
        try:
            input("\n종료하려면 엔터 키를 누르세요...")
        except Exception:
            pass

if __name__ == '__main__':
    main()
