import React from 'react';
import { AIReplyModal } from '../components/AIReplyModal';

// Define event format
export interface OpenModalDetail {
  commentText: string;
  videoId: string;
  videoTitle: string;
  triggerElement: HTMLElement;
}

const ContentApp: React.FC = () => {
  const [modalState, setModalState] = React.useState<OpenModalDetail | null>(null);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<OpenModalDetail>;
      setModalState(customEvent.detail);
    };
    window.addEventListener('ai-suite-open', handler);
    return () => window.removeEventListener('ai-suite-open', handler);
  }, []);

  if (!modalState) return null;

  return (
    <AIReplyModal
      isOpen={true}
      onClose={() => setModalState(null)}
      commentText={modalState.commentText}
      videoId={modalState.videoId}
      videoTitle={modalState.videoTitle}
      parentElement={modalState.triggerElement}
    />
  );
};

export default ContentApp;
