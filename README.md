# Arena Shooter — 모바일 웹 2인 근거리 슈팅 게임 (FSS 팬 게임)

『파이브 스타 스토리』의 파티마를 조종하는 **비공개·비수익 2차 창작 팬 게임**입니다. 공개 배포·수익화를 하지 않습니다.

- 기획서: [docs/모바일_웹_슈팅게임_기획서.md](docs/모바일_웹_슈팅게임_기획서.md)
- 캐릭터 설정: [docs/캐릭터_설정.md](docs/캐릭터_설정.md)

## 구조

```
apps/web            Vite + TypeScript + Phaser 3 클라이언트
  src/sim           순수 TS 시뮬레이션 코어 (60Hz 고정 틱, 결정적 로직, PRNG, 바이너리 직렬화)
  src/net           Transport 인터페이스, WebRTC DataChannel, WebSocket 릴레이, 시그널링 클라이언트
  src/game          Phaser 씬(Boot/Title/Lobby/Arena/Result), 플로팅 가상 스틱
apps/signaling      Node + ws 시그널링/릴레이 서버 (6자리 방 코드, SDP/ICE 중계, 바이너리 릴레이)
packages/protocol   클라이언트·서버 공용 시그널링 메시지 타입
docs                기획서
```

## 실행

```bash
npm install
```

터미널 1 — 시그널링 서버 (기본 포트 8787):

```bash
npm run dev:signaling
```

터미널 2 — 클라이언트 (http, LAN 노출):

```bash
npm run dev
```

폰에서는 PC의 LAN IP로 `http://<PC-IP>:5173` 접속. 시그널링은 같은 오리진의 `/ws` 경로로 프록시되므로 별도 설정이 필요 없습니다.

카메라(QR 스캔)나 Web Bluetooth처럼 secure context가 필요한 기능을 폰에서 테스트할 때는 https로 실행합니다 (자체 서명 인증서 경고는 1회 수락):

```bash
npm run dev:https
```

타입 체크:

```bash
npm run typecheck
```

## 현재 상태 (M1 초기 골격)

- 타이틀에서 파티마 4종(라키시스/클로소/아트로포스/에스트) 선택, 캐릭터별 속도·HP·화력·대시 차이 적용
- 솔로 아레나: 좌측 스틱 이동, 우측 스틱 조준+자동 발사, 대시 버튼
- 로비: 방 만들기 / 코드 입력 참가 → WebRTC DataChannel 연결, 5초 실패 시 릴레이 폴백
- 대전 모드는 상대 입력을 그대로 적용하는 임시 동기화만 있음 (예측/보간/호스트 권위 스냅샷은 M2~M3에서 구현)
