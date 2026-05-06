import './index.css';
import { marked } from 'marked';
import { createSegmentManager } from './renderer/segmentManager.js';
import { createAudioRecorder } from './renderer/audioRecorder.js';
import { createAIChat } from './renderer/aiChat.js';
import { createKnowledgeBase } from './renderer/knowledgeBase.js';
import { createSettings } from './renderer/settings.js';
import { createInterviewReviews } from './renderer/interviewReviews.js';

marked.setOptions({ breaks: true, gfm: true });

// --- DOM 元素集合 ---
const $ = (id) => document.getElementById(id);
const elements = {
  recordBtn: $('recordBtn'), recordLabel: $('recordLabel'), recordIcon: $('recordIcon'),
  statusText: $('statusText'), transcriptArea: $('transcriptArea'),
  settingsBtn: $('settingsBtn'), settingsPanel: $('settingsPanel'),
  langSelect: $('langSelect'), audioDeviceSelect: $('audioDeviceSelect'),
  clearTranscriptBtn: $('clearTranscriptBtn'),
  modeCandidateBtn: $('modeCandidateBtn'), modeInterviewerBtn: $('modeInterviewerBtn'),
  candidatePanel: $('candidatePanel'), interviewerPanel: $('interviewerPanel'),
  aiQuestion: $('aiQuestion'), aiResponse: $('aiResponse'), aiCitations: $('aiCitations'),
  triggerAIBtn: $('triggerAIBtn'),
  uploadPDFBtn: $('uploadPDFBtn'), pdfList: $('pdfList'), pdfStatus: $('pdfStatus'),
  jdInput: $('jdInput'), recommendQuestionsBtn: $('recommendQuestionsBtn'),
  evaluateAnswerBtn: $('evaluateAnswerBtn'), interviewerResponse: $('interviewerResponse'),
  historyList: $('historyList'), clearHistoryBtn: $('clearHistoryBtn'),
  manageKBBtn: $('manageKBBtn'), kbFullpage: $('kbFullpage'), kbBackBtn: $('kbBackBtn'),
  kbGroupList: $('kbGroupList'), kbAddGroupBtn: $('kbAddGroupBtn'), kbFileList: $('kbFileList'),
  kbSearchInput: $('kbSearchInput'), kbChunkList: $('kbChunkList'), kbChunkCount: $('kbChunkCount'),
  kbAddChunkBtn: $('kbAddChunkBtn'), kbUploadBtn: $('kbUploadBtn'),
  kbViewList: $('kbViewList'), kbViewGrid: $('kbViewGrid'),
  kbDrawer: $('kbDrawer'), kbDrawerOverlay: $('kbDrawerOverlay'),
  kbEditorTitle: $('kbEditorTitle'), kbEditorClose: $('kbEditorClose'),
  kbEditorGroup: $('kbEditorGroup'), kbEditorFilename: $('kbEditorFilename'),
  kbEditorContent: $('kbEditorContent'), kbEditorCancel: $('kbEditorCancel'),
  kbEditorSave: $('kbEditorSave'),
  kbAddGroupForm: $('kbAddGroupForm'), kbNewGroupPosition: $('kbNewGroupPosition'),
  kbNewGroupDomain: $('kbNewGroupDomain'), kbNewGroupConfirm: $('kbNewGroupConfirm'),
  kbNewGroupCancel: $('kbNewGroupCancel'),
  kbFileAssign: $('kbFileAssign'), kbFileAssignSelect: $('kbFileAssignSelect'),
  kbFileAssignConfirm: $('kbFileAssignConfirm'), kbReclassifyBtn: $('kbReclassifyBtn'),
  asrEngineSelect: $('asrEngineSelect'), modelStatusItem: $('modelStatusItem'),
  modelStatusIcon: $('modelStatusIcon'), modelStatusText: $('modelStatusText'),
  downloadModelBtn: $('downloadModelBtn'), modelProgress: $('modelProgress'),
  modelProgressFill: $('modelProgressFill'), modelProgressText: $('modelProgressText'),
  ragDebugPanel: $('ragDebugPanel'), ragDebugToggle: $('ragDebugToggle'),
  ragDebugContent: $('ragDebugContent'),
  systemAudioToggle: $('systemAudioToggle'),
  agentPanel: $('agentPanel'), agentSteps: $('agentSteps'), agentContent: $('agentContent'),
  positionSelect: $('positionSelect'),
  reviewSessionList: $('reviewSessionList'), reviewRefreshBtn: $('reviewRefreshBtn'),
  reviewDetailPanel: $('reviewDetailPanel'), reviewDetailTitle: $('reviewDetailTitle'),
  reviewDetailContent: $('reviewDetailContent'), reviewDetailClose: $('reviewDetailClose'),
};

const electronAPI = window.electronAPI;

// --- 初始化模块（按依赖顺序） ---

const settings = createSettings({ elements, electronAPI });

const segmentManager = createSegmentManager({
  elements,
  onRequestAI: (text) => aiChat.requestAICompletion(text),
  onSegmentChange: (segment) => {
    electronAPI.recordInterviewSegment(segment).catch(err => {
      console.warn('[InterviewReview] Failed to record segment:', err);
    });
  },
});

const aiChat = createAIChat({
  elements,
  electronAPI,
  getSelectedText: () => segmentManager.getSelectedText(),
  getCurrentMode: () => settings.getCurrentMode(),
  getActivePosition: () => settings.getActivePosition(),
  addToHistory: (q, a) => settings.addToHistory(q, a),
});

const kb = createKnowledgeBase({
  elements,
  electronAPI,
  refreshPDFList: () => settings.refreshPDFList(),
});

const interviewReviews = createInterviewReviews({
  elements,
  electronAPI,
});

createAudioRecorder({
  elements,
  segmentManager,
  electronAPI,
  getActivePosition: () => settings.getActivePosition(),
  getCurrentMode: () => settings.getCurrentMode(),
  onReviewComplete: () => interviewReviews.refreshReviewSessions(),
});

// --- IPC: 流式识别结果 ---
electronAPI.onStreamResult((data) => {
  const sourceId = data.sourceId || 'default';
  let fullText = '';
  let speakerId = null;
  if (data.utterances && data.utterances.length > 0) {
    fullText = data.utterances.map(u => u.text).join('');
    const definiteUtterance = data.utterances.find(u => u.definite && u.speaker);
    const anyWithSpeaker = data.utterances.find(u => u.speaker);
    speakerId = (definiteUtterance || anyWithSpeaker)?.speaker || null;
  } else if (data.text) {
    fullText = data.text;
  }
  segmentManager.updateCurrentSegment(fullText, sourceId, speakerId);
});

electronAPI.onStreamError((data) => {
  const msg = typeof data === 'string' ? data : data.message;
  elements.statusText.textContent = `错误: ${msg}`;
});

// --- 快捷键 ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (kb.isOpen()) { kb.closeDrawer(); return; }
    if (kb.isFullpageOpen()) { kb.closeFullpage(); return; }
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    const text = segmentManager.getSelectedText();
    if (text.trim()) aiChat.requestAICompletion(text);
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    settings.switchMode(settings.getCurrentMode() === 'candidate' ? 'interviewer' : 'candidate');
  }
});

elements.clearTranscriptBtn.addEventListener('click', () => segmentManager.clear());

// --- 启动 ---
settings.loadSettings();
settings.renderHistory();
settings.refreshPDFList();
interviewReviews.refreshReviewSessions();
segmentManager.render();
