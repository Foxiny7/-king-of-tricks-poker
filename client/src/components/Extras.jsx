import { useState } from 'react';
import GameWindow from './GameWindow';

const NOTES = [
  { date: '2026-09-27', title: '牌桌与界面', items: ['牌桌铺满画面；手牌移到左下，操作区移到右下。', '四款手部贴图更新，袖口更宽。', '新增好友申请与房间邀请。', '设置新增音量、播报风格和皮肤选项。'] },
  { date: '2026-09-26', title: '千术调整', items: ['登神只能由登神阶梯 III 获得。', '千术反转可响应作用于全场的主动千术。'] },
];

// The 活动 window from the title screen; the update notes are its 公告 tab.
export function Events({ onClose }) {
  const [tab, setTab] = useState('news');
  return <GameWindow title="活动" tabs={[{ id: 'news', label: '公告' }, { id: 'events', label: '限时活动' }]}
    tab={tab} onTab={setTab} onClose={onClose}>
    {tab === 'news' && <div className="announcement-list">{NOTES.map((note) => <section key={note.date}>
      <time>{note.date}</time><h3>{note.title}</h3>
      <ul>{note.items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>)}</div>}
    {tab === 'events' && <p className="friend-empty">暂无进行中的活动</p>}
  </GameWindow>;
}

export function EmptyPage({ title, onClose }) {
  const [tab, setTab] = useState('main');
  return <GameWindow title={title} tabs={[{ id: 'main', label: title }]} tab={tab} onTab={setTab} onClose={onClose}>
    <p className="friend-empty">暂未开放</p>
  </GameWindow>;
}
