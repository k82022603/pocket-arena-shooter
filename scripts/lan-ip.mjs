import { networkInterfaces } from 'node:os';

// Hyper-V/WSL/VM 가상 어댑터는 폰에서 닿지 않으므로 제외한다
const VIRTUAL = /(vEthernet|WSL|Hyper-V|Default Switch|VirtualBox|VMware|Loopback|docker|Bluetooth|Npcap)/i;
const WIRELESS = /(Wi-?Fi|wlan|Wireless|무선)/i; // 무선 어댑터 이름 (한글 Windows는 '무선')

// 폰이 접속할 수 있는 이 PC의 IPv4 주소. Wi‑Fi 어댑터를 우선한다.
export function lanIPv4() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || VIRTUAL.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue; // IPv6와 127.0.0.1 같은 내부 주소는 뺀다
      candidates.push({ name, address: addr.address });
    }
  }
  const wireless = candidates.find((c) => WIRELESS.test(c.name));
  return (wireless ?? candidates[0])?.address ?? null; // 무선이 없으면 첫 유선, 그것도 없으면 null
}
