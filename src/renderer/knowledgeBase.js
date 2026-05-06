export function createKnowledgeBase({ elements, electronAPI, refreshPDFList }) {
  const { kbFullpage, kbBackBtn, kbGroupList, kbAddGroupBtn, kbFileList, kbSearchInput,
    kbChunkList, kbChunkCount, kbAddChunkBtn, kbUploadBtn, kbViewList, kbViewGrid,
    kbDrawer, kbDrawerOverlay, kbEditorTitle, kbEditorClose, kbEditorGroup,
    kbEditorFilename, kbEditorContent, kbEditorCancel, kbEditorSave, manageKBBtn,
    kbAddGroupForm, kbNewGroupPosition, kbNewGroupDomain, kbNewGroupConfirm, kbNewGroupCancel,
    kbFileAssign, kbFileAssignSelect, kbFileAssignConfirm, kbReclassifyBtn } = elements;

  let kbGroups = { positions: [] };
  let kbActivePosition = '';
  let kbActiveDomain = '';
  let kbActiveFile = '';
  let kbEditingChunkId = null;
  let kbViewMode = 'list';

  manageKBBtn.addEventListener('click', () => { kbFullpage.classList.remove('hidden'); loadKBData(); });
  kbBackBtn.addEventListener('click', () => { kbFullpage.classList.add('hidden'); closeDrawer(); });
  kbUploadBtn.addEventListener('click', async () => {
    const result = await electronAPI.uploadPDF();
    if (result.success) { loadKBData(); refreshPDFList(); }
  });

  kbReclassifyBtn.addEventListener('click', async () => {
    kbReclassifyBtn.disabled = true;
    kbReclassifyBtn.textContent = '分类中...';
    try {
      const result = await electronAPI.reclassifyChunks();
      if (result.count > 0) loadKBData();
      kbReclassifyBtn.textContent = result.count > 0 ? `已分类 ${result.count} 条` : '无需分类';
      setTimeout(() => { kbReclassifyBtn.textContent = '自动分类'; kbReclassifyBtn.disabled = false; }, 2000);
    } catch {
      kbReclassifyBtn.textContent = '分类失败';
      setTimeout(() => { kbReclassifyBtn.textContent = '自动分类'; kbReclassifyBtn.disabled = false; }, 2000);
    }
  });

  kbViewList.addEventListener('click', () => { kbViewMode = 'list'; kbViewList.classList.add('active'); kbViewGrid.classList.remove('active'); kbChunkList.classList.remove('grid'); });
  kbViewGrid.addEventListener('click', () => { kbViewMode = 'grid'; kbViewGrid.classList.add('active'); kbViewList.classList.remove('active'); kbChunkList.classList.add('grid'); });

  // --- 新建分组 (inline form) ---
  kbAddGroupBtn.addEventListener('click', () => {
    kbAddGroupForm.classList.remove('hidden');
    kbAddGroupBtn.classList.add('hidden');
    populatePositionSelect(kbNewGroupPosition, true);
    kbNewGroupDomain.value = '';
    kbNewGroupDomain.focus();
  });

  kbNewGroupCancel.addEventListener('click', () => {
    kbAddGroupForm.classList.add('hidden');
    kbAddGroupBtn.classList.remove('hidden');
  });

  kbNewGroupConfirm.addEventListener('click', () => {
    let posId = kbNewGroupPosition.value;
    const domainName = kbNewGroupDomain.value.trim();
    if (!domainName) return;

    if (posId === '__new__') {
      const newPosName = kbNewGroupDomain.dataset.newPosition;
      if (!newPosName) return;
      const newId = newPosName.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '-');
      const newPos = { id: newId, name: newPosName, domains: [] };
      kbGroups.positions.push(newPos);
      posId = newId;
    }

    const pos = kbGroups.positions.find(p => p.id === posId);
    if (!pos) return;
    if (pos.domains.some(d => d.name === domainName)) return;

    const domainId = domainName.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '-');
    pos.domains.push({ id: domainId, name: domainName });
    electronAPI.saveGroups(kbGroups);

    kbAddGroupForm.classList.add('hidden');
    kbAddGroupBtn.classList.remove('hidden');
    renderSidebarGroups();
  });

  // --- 文件岗位分配 ---
  if (kbFileAssignConfirm) {
    kbFileAssignConfirm.addEventListener('click', async () => {
      if (!kbActiveFile) return;
      const val = kbFileAssignSelect.value;
      if (!val) return;
      const [position, domain] = val.split('/');
      await electronAPI.setDocumentGroup(kbActiveFile, position, domain);
      kbFileAssign.classList.add('hidden');
      loadChunks();
    });
  }

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

    const groupVal = kbEditorGroup.value;
    const [position, domain] = groupVal ? groupVal.split('/') : ['', ''];

    try {
      if (kbEditingChunkId) {
        await electronAPI.updateChunk(kbEditingChunkId, { content, position, domain });
      } else {
        await electronAPI.addChunk({ content, position, domain, filename: kbEditorFilename.value || '手动添加', sourceType: 'manual' });
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
    kbGroups = result.success ? result.groups : { positions: [] };
    if (Array.isArray(kbGroups) || !kbGroups.positions) kbGroups = { positions: [] };
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
      div.addEventListener('click', () => {
        const wasActive = kbActiveFile === pdf.filename;
        kbActiveFile = wasActive ? '' : pdf.filename;
        loadFiles();
        loadChunks();
        if (!wasActive) {
          showFileAssign();
        } else {
          kbFileAssign.classList.add('hidden');
        }
      });
      kbFileList.appendChild(div);
    }
  }

  function showFileAssign() {
    if (!kbFileAssign) return;
    populateGroupSelect(kbFileAssignSelect);
    kbFileAssign.classList.remove('hidden');
  }

  function populatePositionSelect(select, includeNew) {
    select.innerHTML = '';
    for (const pos of (kbGroups.positions || [])) {
      const opt = document.createElement('option');
      opt.value = pos.id;
      opt.textContent = pos.name;
      select.appendChild(opt);
    }
    if (includeNew) {
      const opt = document.createElement('option');
      opt.value = '__new__';
      opt.textContent = '+ 新建岗位...';
      select.appendChild(opt);
    }
  }

  function populateGroupSelect(select) {
    select.innerHTML = '<option value="">选择分类...</option>';
    for (const pos of (kbGroups.positions || [])) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = pos.name;
      for (const domain of pos.domains) {
        const opt = document.createElement('option');
        opt.value = `${pos.id}/${domain.id}`;
        opt.textContent = domain.name;
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }
  }

  function renderSidebarGroups() {
    kbGroupList.innerHTML = '';

    const allItem = document.createElement('div');
    allItem.className = `kb-group-item${kbActivePosition === '' && kbActiveDomain === '' ? ' active' : ''}`;
    allItem.innerHTML = `<span class="kb-group-icon">📁</span><span class="kb-group-name">全部</span>`;
    allItem.addEventListener('click', () => { kbActivePosition = ''; kbActiveDomain = ''; renderSidebarGroups(); loadChunks(); });
    kbGroupList.appendChild(allItem);

    for (const pos of (kbGroups.positions || [])) {
      const isExpanded = kbActivePosition === pos.id;
      const posItem = document.createElement('div');
      posItem.className = `kb-group-item position${isExpanded ? ' expanded' : ''}${kbActivePosition === pos.id && kbActiveDomain === '' ? ' active' : ''}`;
      posItem.innerHTML = `<span class="kb-group-icon">${isExpanded ? '▼' : '▶'}</span><span class="kb-group-name">${pos.name}</span><span class="kb-group-badge">${pos.domains.length}</span>`;
      posItem.addEventListener('click', () => {
        if (kbActivePosition === pos.id && kbActiveDomain === '') {
          kbActivePosition = ''; kbActiveDomain = '';
        } else {
          kbActivePosition = pos.id; kbActiveDomain = '';
        }
        renderSidebarGroups(); loadChunks();
      });
      posItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`删除岗位「${pos.name}」及其所有领域？（不会删除知识片段）`)) {
          kbGroups.positions = kbGroups.positions.filter(p => p.id !== pos.id);
          electronAPI.saveGroups(kbGroups);
          if (kbActivePosition === pos.id) { kbActivePosition = ''; kbActiveDomain = ''; }
          renderSidebarGroups();
        }
      });
      kbGroupList.appendChild(posItem);

      if (isExpanded) {
        for (const domain of pos.domains) {
          const domItem = document.createElement('div');
          domItem.className = `kb-group-item domain${kbActiveDomain === domain.id ? ' active' : ''}`;
          domItem.innerHTML = `<span class="kb-group-icon">·</span><span class="kb-group-name">${domain.name}</span>`;
          domItem.style.paddingLeft = '28px';
          domItem.addEventListener('click', (e) => {
            e.stopPropagation();
            kbActiveDomain = kbActiveDomain === domain.id ? '' : domain.id;
            renderSidebarGroups(); loadChunks();
          });
          domItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`删除领域「${domain.name}」？（不会删除知识片段）`)) {
              pos.domains = pos.domains.filter(d => d.id !== domain.id);
              electronAPI.saveGroups(kbGroups);
              if (kbActiveDomain === domain.id) kbActiveDomain = '';
              renderSidebarGroups();
            }
          });
          kbGroupList.appendChild(domItem);
        }
      }
    }
  }

  async function loadChunks() {
    const filters = {};
    if (kbActivePosition) filters.position = kbActivePosition;
    if (kbActiveDomain) filters.domain = kbActiveDomain;
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
      const posTag = chunk.position ? `<span class="kb-chunk-tag position">${getPositionName(chunk.position)}</span>` : '';
      const domainTag = chunk.domain ? `<span class="kb-chunk-tag group">${getDomainName(chunk.position, chunk.domain)}</span>` : '';
      const time = chunk.updatedAt ? new Date(chunk.updatedAt).toLocaleDateString() : '';
      div.innerHTML = `<div class="kb-chunk-header"><span class="kb-chunk-filename">${chunk.filename || ''}</span><span class="kb-chunk-tag ${typeClass}">${typeLabel}</span>${posTag}${domainTag}</div><div class="kb-chunk-content">${chunk.content.substring(0, 300)}</div><div class="kb-chunk-meta"><span class="kb-chunk-time">${time}</span><div class="kb-chunk-actions"><button class="small-btn" data-action="edit">编辑</button><button class="small-btn danger" data-action="delete">删除</button></div></div>`;
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

  function getPositionName(posId) {
    const pos = (kbGroups.positions || []).find(p => p.id === posId);
    return pos ? pos.name : posId;
  }

  function getDomainName(posId, domainId) {
    const pos = (kbGroups.positions || []).find(p => p.id === posId);
    if (!pos) return domainId;
    const domain = pos.domains.find(d => d.id === domainId);
    return domain ? domain.name : domainId;
  }

  function openDrawer(chunk) {
    kbEditingChunkId = chunk ? chunk.id : null;
    kbEditorTitle.textContent = chunk ? '编辑知识片段' : '添加知识片段';
    kbEditorContent.value = chunk ? chunk.content : '';
    kbEditorFilename.value = chunk ? (chunk.filename || '') : '手动添加';
    kbEditorFilename.disabled = !!chunk;

    populateGroupSelect(kbEditorGroup);

    const chunkVal = chunk && chunk.position && chunk.domain ? `${chunk.position}/${chunk.domain}` : '';
    const activeVal = kbActivePosition && kbActiveDomain ? `${kbActivePosition}/${kbActiveDomain}` : '';
    kbEditorGroup.value = chunkVal || activeVal || '';

    kbDrawer.classList.remove('hidden');
    kbDrawerOverlay.classList.remove('hidden');
  }

  function closeDrawer() {
    kbDrawer.classList.add('hidden');
    kbDrawerOverlay.classList.add('hidden');
  }

  return {
    closeDrawer,
    isOpen: () => !kbDrawer.classList.contains('hidden'),
    isFullpageOpen: () => !kbFullpage.classList.contains('hidden'),
    closeFullpage: () => kbFullpage.classList.add('hidden'),
    loadKBData,
  };
}
