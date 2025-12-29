// REMOVED DIRECT IMPORT OF PUTER TO PREVENT CONTENT SCRIPT CRASHES
// import puter from '../lib/puter-web'; 

export const generateReply = async (
  transcript: string,
  userComment: string,
  globalPrompt: string,
  videoTitle: string
): Promise<string> => {

  const context = {
    transcript,
    userComment,
    globalPrompt,
    videoTitle
  };

  try {
    // Send message to Background Script which has access to Puter.js in a safe environment
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_REPLY_FULL', // New type for full generation with transcript
      context: context
    });

    if (response && response.success) {
      return response.text;
    } else {
      throw new Error(response?.error || 'Unknown error from background service');
    }

  } catch (error) {
    console.error('AI Generation Error Service:', error);
    throw new Error('Falha ao gerar resposta com IA. Verifique se o Background Script está rodando.');
  }

};
