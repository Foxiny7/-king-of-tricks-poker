# 千王之王2026

给中美两地的朋友凑一桌用的网页德州扑克，2~10 人，纯记分不涉及真钱。房主开房、设初始筹码和规则，大家用浏览器打开链接就能玩，不用装 App。

现在能玩什么：

- 标准德扑流程，边池/短牌全下都算对
- 房主能调的规则：加注规则（不限次数 / 每轮每人限一次）、单次加注上限、单轮下注上限，盲注是固定几档（10/20 到 500/1000），不会因为改筹码数就跟着变
- 全下会自动按"我的筹码"和"场上其他人筹码"里更小的算，不会出现全下一堆没人接得住的情况；有人全下之后这一轮其他人就只能跟注了
- 断线重连：换设备也行，同一房间码 + 同一个名字就能接回原来的位置
- 房主能踢人、能给出局的人补筹码让他们下一局回来打
- 摊牌后可以花 20 筹码看某个弃牌玩家的手牌，弃牌的人自己也能选择主动亮牌
- 每局结束不会自动开下一局，要大家都点"继续"才开始（45 秒没点齐会自动跳过，免得卡住）
- 房间战绩会记着这一路打了几局、每局谁赢了多少
- 语音聊天（WebRTC，P2P + TURN 中继兜底），还有个简单的表情/送礼物功能活跃气氛
- 首页可以换皮肤：3 种卡牌样式（经典文字/精致插画/极简暗色）+ 4 种牌桌颜色（绿/红/蓝/紫），选择存在本地，各人独立

## 本地跑起来

`server/` 和 `client/` 各自 `npm install` 一次。

```bash
# 终端 1：后端，默认 3001
cd server
npm run dev

# 终端 2：前端，默认 5173，带热更新
cd client
npm run dev
```

打开 `http://localhost:5173`。开发模式下前端请求打到 `http://localhost:3001`。

## 部署

```bash
cd client
npm run build          # 出 client/dist

cd ../server
npm install --omit=dev
PORT=3001 node src/index.js
```

`server/src/index.js` 直接把 `client/dist` 当静态资源托管，线上只需要跑这一个 Node 进程，不用单独部署前端。

**语音功能要求 HTTPS**（浏览器麦克风权限的硬性限制），纯 IP 访问是拿不到麦克风的。没有域名的话可以用 [sslip.io](https://sslip.io) 这种免费通配符 DNS（比如 `你的IP.sslip.io`）配合 Caddy 自动签 Let's Encrypt 证书，不用自己折腾 nginx + certbot：

```
# /etc/caddy/Caddyfile
你的IP.sslip.io {
    reverse_proxy localhost:3001
}
```

语音跨 NAT 打洞如果失败需要 TURN 中继兜底，装个 coturn，然后启动 server 时把这几个环境变量带上：

```bash
TURN_HOST=你的IP TURN_USERNAME=xxx TURN_PASSWORD=xxx node src/index.js
```

`/ice-servers` 接口会把这些拼成前端要用的 ICE server 列表。

服务器选址：新加坡或东京的小 VPS 对中美双边访问都还算稳，也不用大陆的 ICP 备案。

## 目录结构

- `server/src/gameEngine.js` — 游戏规则核心：发牌、下注轮、边池、全下上限、摊牌判定
- `server/src/room.js` / `roomManager.js` — 房间和玩家状态
- `server/src/socketHandlers.js` — 所有 Socket.io 事件，房间状态广播、语音信令转发、表情/礼物转发
- `client/src/components/` — 各个界面（大厅、牌桌、语音、表情等）
- `client/public/icons` / `sounds` / `textures` — 素材文件（见下方素材来源）

## 素材来源

界面用到的图片/音效都是免费可商用授权的素材，本地打包进项目，不依赖外部 CDN：

- 表情/礼物图标：[Twemoji](https://github.com/twitter/twemoji)（CC-BY 4.0，图形版权 © Twitter, Inc 及其他贡献者）
- 胜负音效：[Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)（CC0）
- 背景纹理：[ambientCG Fabric022](https://ambientcg.com/view?id=Fabric022)（CC0，改过色调）

扑克牌面还是用文字+符号现场渲染（`client/src/components/Card.jsx`），没有用图片素材。
