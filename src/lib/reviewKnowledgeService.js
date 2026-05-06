export async function persistReviewKnowledge({ review, session, pineconeService }) {
  const cards = review?.knowledgeCards || [];
  if (!cards.length) return 0;

  let count = 0;
  const date = new Date(session.startedAt || Date.now()).toLocaleDateString('zh-CN');
  const filename = `面试复盘-${date}-${session.position || '通用'}`;

  for (const card of cards) {
    try {
      await pineconeService.addChunk({
        content: card.content,
        position: card.position || session.position || '',
        domain: card.domain || 'interview_review',
        filename,
        sourceType: 'interview_review',
      });
      count++;
    } catch (error) {
      console.error('[ReviewKnowledge] Failed to persist card:', error);
    }
  }

  return count;
}
