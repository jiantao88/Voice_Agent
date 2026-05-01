export function createKnowledgeBase({ elements, electronAPI, refreshPDFList }) {
  const { kbFullpage, kbBackBtn, kbGroupList, kbAddGroupBtn, kbFileList, kbSearchInput,
    kbChunkList, kbChunkCount, kbAddChunkBtn, kbUploadBtn, kbViewList, kbViewGrid,
    kbDrawer, kbDrawerOverlay, kbEditorTitle, kbEditorClose, kbEditorGroup,
    kbEditorFilename, kbEditorContent, kbEditorCancel, kbEditorSave, manageKBBtn } = elements;

  let kbGroups = [];
  let kbActiveGroup = '';
  let kbActiveFile = '';
  let kbEditingChunkId = null;
  let kbViewMode = 'list';

  manageKBBtn.addEventListener('click', () => { kbFullpage.classList.remove('hidden'); loadKBData(); });
  kbBackBtn.addEventListener('click', () => { kbFullpage.classList.add('hidden'); closeDrawer(); });
  kbUploadBtn.addEventListener('click', async () => {
    const result = await electronAPI.uploadPDF();
    if (result.success) { loadKBData(); refreshPDFList(); }
  });

  kbViewList.addEventListener('click', () => { kbViewMode = 'list'; kbViewList.classList.add('active'); kbViewGrid.classList.remove('active'); kbChunkList.classList.remove('grid'); });
  kbViewGrid.addEventListener('click', () => { kbViewMode = 'grid'; kbViewGrid.classList.add('active'); kbViewList.classList.remove('active'); kbChunkList.classList.add('grid'); });

  kbAddGroupBtn.addEventListener('click', () => {
    const name = prompt('输入分组名称：');
    if (!name || !name.trim()) return;
    if (kbGroups.some(g => g.name === name.trim())) return;
    kbGroups.push({ name: name.trim() });
    electronAPI.saveGroups(kbGroups);
    renderSidebarGroups();
  });

  let searchTimer = null;
  kbSearchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadChunks(), 300); });

  kbAddChunkBtn.addEventListener('click', () => openDrawer(null));
  kbEditorClose.addEventListener('click', closeDrawer);
  kbEditorCancel.addEventListener('click', closeDrawer);
  kbDrawerOverlay.addEventListener('click', closeDrawer);

  kbEditorSave.addEventListener('click', async () => {
    const content = kbEditorContent.value.trim();
    if (!content) return;
    kbEditorSave.disabled = true;
    kbEditorSave.textContent = '保存中...';
    try {
      if (kbEditingChunkId) {
        await electronAPI.updateChunk(kbEditingChunkId, { content, group: kbEditorGroup.value });
      } else {
        await electronAPI.addChunk({ content, group: kbEditorGroup.value, filename: kbEditorFilename.value || '手动添加', sourceType: 'manual' });
      }
      closeDrawer();
      loadChunks();
      refreshPDFList();
    } catch (err) {
      alert('保存失败: ' + err.message);
    } finally {
      kbEditorSave.disabled = false;
      kbEditorSave.textContent = '保存';
    }
  });

  async function loadKBData() {
    await Promise.all([loadGroups(), loadFiles(), loadChunks()]);
  }

  async function loadGroups() {
    const result = await electronAPI.listGroups();
    kbGroups = result.success ? result.groups : [];
    renderSidebarGroups();
  }

  async function loadFiles() {
    const result = await electronAPI.listPDFs();
    if (!result.success) return;
    kbFileList.innerHTML = '';
    for (const pdf of result.pdfs) {
      const div = document.createElement('div');
      div.className = `kb-file-item${kbActiveFile === pdf.filename ? ' active' : ''}`;
      div.innerHTML = `<span class="kb-file-icon">📄</span><span class="kb-file-name">${pdf.filename}</span><span class="kb-file-badge">${pdf.chunks}</span>`;
      div.addEventListener('click', () => { kbActiveFile = kbActiveFile === pdf.filename ? '' : pdf.filename; loadFiles(); loadChunks(); });
      kbFileList.appendChild(div);
    }
  }

  function renderSidebarGroups() {
    kbGroupList.innerHTML = '';
    const allItem = document.createElement('div');
    allItem.className = `kb-group-item${kbActiveGroup === '' ? ' active' : ''}`;
    allItem.innerHTML = `<span class="kb-group-icon">📁</span><span class="kb-group-name">全部</span>`;
    allItem.addEventListener('click', () => { kbActiveGroup = ''; renderSidebarGroups(); loadChunks(); });
    kbGroupList.appendChild(allItem);

    for (const g of kbGroups) {
      const item = document.createElement('div');
      item.className = `kb-group-item${kbActiveGroup === g.name ? ' active' : ''}`;
      item.innerHTML = `<span class="kb-group-icon">📂</span><span class="kb-group-name">${g.name}</span>`;
      item.addEventListener('click', () => { kbActiveGroup = g.name; renderSidebarGroups(); loadChunks(); });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`删除分组「${g.name}」？（不会删除知识片段）`)) {
          kbGroups = kbGroups.filter(x => x.name !== g.name);
          electronAPI.saveGroups(kbGroups);
          if (kbActiveGroup === g.name) kbActiveGroup = '';
          renderSidebarGroups();
        }
      });
      kbGroupList.appendChild(item);
    }
  }

  async function loadChunks() {
    const filters = {};
    if (kbActiveGroup) filters.group = kbActiveGroup;
    if (kbActiveFile) filters.filename = kbActiveFile;
    const searchText = kbSearchInput.value.trim();
    if (searchText) filters.searchText = searchText;

    const result = await electronAPI.listChunks(filters);
    if (!result.success) return;

    const chunks = result.chunks;
    kbChunkCount.textContent = `${chunks.length} 条知识片段`;

    kbChunkList.innerHTML = '';
    if (chunks.length === 0) {
      kbChunkList.innerHTML = `<div class="kb-empty"><div class="kb-empty-icon">📚</div><div class="kb-empty-text">还没有知识片段</div><div class="kb-empty-hint">上传 PDF 或 Markdown 文档，或手动添加知识</div></div>`;
      return;
    }

    for (const chunk of chunks) {
      const div = document.createElement('div');
      div.className = 'kb-chunk-item';
      const typeClass = chunk.sourceType || 'pdf';
      const typeLabel = typeClass === 'manual' ? '手动' : typeClass === 'markdown' ? 'MD' : 'PDF';
      const groupTag = chunk.group ? `<span class="kb-chunk-tag group">${chunk.group}</span>` : '';
      const time = chunk.updatedAt ? new Date(chunk.updatedAt).toLocaleDateString() : '';
      div.innerHTML = `<div class="kb-chunk-header"><span class="kb-chunk-filename">${chunk.filename || ''}</span><span class="kb-chunk-tag ${typeClass}">${typeLabel}</span>${groupTag}</div><div class="kb-chunk-content">${chunk.content.substring(0, 300)}</div><div class="kb-chunk-meta"><span class="kb-chunk-time">${time}</span><div class="kb-chunk-actions"><button class="small-btn" data-action="edit">编辑</button><button class="small-btn danger" data-action="delete">删除</button></div></div>`;
      div.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openDrawer(chunk); });
      div.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确认删除这条知识片段？')) return;
        await electronAPI.deleteChunk(chunk.id);
        loadChunks();
      });
      kbChunkList.appendChild(div);
    }
  }

  function openDrawer(chunk) {
    kbEditingChunkId = chunk ? chunk.id : null;
    kbEditorTitle.textContent = chunk ? '编辑知识片段' : '添加知识片段';
    kbEditorContent.value = chunk ? chunk.content : '';
    kbEditorFilename.value = chunk ? (chunk.filename || '') : '手动添加';
    kbEditorFilename.disabled = !!chunk;
    kbEditorGroup.innerHTML = '<option value="">无分组</option>';
    for (const g of kbGroups) {
      const opt = document.createElement('option');
      opt.value = g.name;
      opt.textContent = g.name;
      kbEditorGroup.appendChild(opt);
    }
    kbEditorGroup.value = chunk ? (chunk.group || '') : kbActiveGroup;
    kbDrawer.classList.remove('hidden');
    kbDrawerOverlay.classList.remove('hidden');
  }

  function closeDrawer() {
    kbDrawer.classList.add('hidden');
    kbDrawerOverlay.classList.add('hidden');
  }

  return { closeDrawer, isOpen: () => !kbDrawer.classList.contains('hidden'), isFullpageOpen: () => !kbFullpage.classList.contains('hidden'), closeFullpage: () => kbFullpage.classList.add('hidden') };
}
