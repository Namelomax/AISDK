'use client';
import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Tab = {
  id: string;
  name: string;
  text: string;
};

type SlidingTabBarProps = {
  onSendPrompt: (promptText: string) => void;
};

const allTabs: Tab[] = [
  { id: 'prompt', name: 'Prompt', text: 'Добро пожаловать домой!' },
];

export const SlidingTabBar = ({ onSendPrompt }: SlidingTabBarProps) => {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);
  const [tabUnderlineWidth, setTabUnderlineWidth] = useState(0);
  const [tabUnderlineLeft, setTabUnderlineLeft] = useState(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [text, setText] = useState<string>(allTabs[0].text);

  useEffect(() => {
    const currentTab = tabsRef.current[activeTabIndex];
    if (currentTab) {
      setTabUnderlineLeft(currentTab.offsetLeft);
      setTabUnderlineWidth(currentTab.clientWidth);
    }
  }, [activeTabIndex]);

  const handleTabClick = (index: number) => {
    if (index === activeTabIndex) {
      setShowPopup((prev) => !prev);
    } else {
      setActiveTabIndex(index);
      setShowPopup(true);
      setText(allTabs[index].text);
    }
  };

  const handleSend = async () => {
  await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newSystemPrompt: text }),
  });
  alert('✅ Промт обновлён!');
};


  return (
    <div className="relative flex flex-col items-center mx-auto">
      {/* Сама панель вкладок */}
      <div className="relative flex h-12 items-center rounded-3xl border border-black/40 bg-neutral-800 px-2 backdrop-blur-sm">
        <span
          className="absolute bottom-0 top-0 -z-10 flex overflow-hidden rounded-3xl py-2 transition-all duration-300 pointer-events-none"
          style={{ left: tabUnderlineLeft, width: tabUnderlineWidth }}
        >
          <span className="h-full w-full rounded-3xl bg-gray-200/30" />
        </span>

        {allTabs.map((tab, index) => {
          const isActive = activeTabIndex === index;
          return (
            <button
              key={tab.id}
              ref={(el) => (tabsRef.current[index] = el)}
              onClick={() => handleTabClick(index)}
              className={`my-auto cursor-pointer select-none rounded-full px-4 text-center font-light transition-colors duration-200 ${
                isActive ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Плашка с текстом (редактируемая) */}
      <AnimatePresence>
  {showPopup && (
    <motion.div
      key={allTabs[activeTabIndex].id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 8 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25 }}
      className="absolute left-0 top-14 w-80 rounded-xl bg-neutral-800 text-white border border-neutral-700 px-4 py-3 shadow-lg"
    >
      <textarea
        className="w-full bg-transparent border border-neutral-600 rounded-md p-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-neutral-400 resize-none"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-start mt-2">
        <button
          onClick={handleSend}
          className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-sm transition"
        >
          Отправить
        </button>
      </div>
    </motion.div>
  )}
</AnimatePresence>

    </div>
  );
};
