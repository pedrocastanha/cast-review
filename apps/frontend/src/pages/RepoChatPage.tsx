import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/chat/ChatPanel';

export function RepoChatPage() {
  const { owner = '', repo = '' } = useParams();

  return (
    <ChatPanel
      scope={{ mode: 'repository', repoId: `${owner}/${repo}` }}
      emptyHint="Abra uma conversa para perguntar sobre este repositório. As respostas saem do índice do código e vêm com evidência clicável."
    />
  );
}
