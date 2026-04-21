// ============================================================
// Sillot AirScript 1.0 脚本 - 金山文档多维表同步
// ============================================================
// 使用方式：
//   1. 在金山文档中新建「多维表」文档
//   2. 在多维表中新建 AirScript 1.0 文档共享脚本
//   3. 将此代码粘贴到脚本编辑器中
//   4. 在脚本编辑器中点击「服务」→「添加服务」→ 勾选「网络API」（如需出站请求）
//   5. 在脚本编辑器侧边栏，右键此脚本 → 复制 Webhook 链接
//   6. 在 AirScript 编辑器中点击「脚本令牌」按钮生成 Token
//   7. 将 Webhook URL 和 Token 填入 Obsidian 插件设置
//
// 重要：此脚本必须运行在「多维表」文档中，使用多维表 API 1.0
//       智能表格文档不支持此脚本
// ============================================================

function formatDateTime(date) {
  if (!date) date = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) + ' ' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds());
}

function getSheetByName(name) {
  var sheets = Application.Sheet.GetSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].name === name) return sheets[i];
  }
  return null;
}

function fetchAllRecords(sheetId) {
  var all = [];
  var offset = '';
  while (true) {
    var opts = { SheetId: sheetId };
    if (offset) opts.Offset = offset;
    var result = Application.Record.GetRecords(opts);
    if (result.records) {
      all = all.concat(result.records);
    }
    if (!result.offset) break;
    offset = result.offset;
  }
  return all;
}

// ==================== 插件级同步 ====================

function getPluginSync(data) {
  var sheet = getSheetByName('plugin_sync_registry');
  if (!sheet) return { success: false, error: 'Table plugin_sync_registry not found' };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields && r.fields['sync_id'] === data.sync_id) {
      return {
        success: true,
        data: {
          sync_id: r.fields['sync_id'],
          sync_type: r.fields['sync_type'],
          cloud_version_time: r.fields['cloud_version_time'],
          sync_content: r.fields['sync_content'],
          description: r.fields['description'],
          category: r.fields['category'],
          updated_at: r.fields['updated_at']
        }
      };
    }
  }
  return { success: true, data: null };
}

function upsertPluginSync(data) {
  var sheet = getSheetByName('plugin_sync_registry');
  if (!sheet) return { success: false, error: 'Table plugin_sync_registry not found' };

  var now = formatDateTime(new Date());
  var records = fetchAllRecords(sheet.id);
  var existingId = null;

  for (var i = 0; i < records.length; i++) {
    if (records[i].fields && records[i].fields['sync_id'] === data.sync_id) {
      existingId = records[i].id;
      break;
    }
  }

  if (existingId) {
    var updateFields = {
      'cloud_version_time': now,
      'sync_content': data.sync_content,
      'updated_at': now
    };
    if (data.description !== undefined) updateFields['description'] = data.description;
    if (data.category !== undefined) updateFields['category'] = data.category;

    Application.Record.UpdateRecords({
      SheetId: sheet.id,
      Records: [{ id: existingId, fields: updateFields }]
    });
    return { success: true, action: 'updated', cloud_version_time: now };
  } else {
    var createFields = {
      'sync_id': data.sync_id,
      'sync_type': data.sync_type || 'inline',
      'cloud_version_time': now,
      'sync_content': data.sync_content,
      'description': data.description || '',
      'category': data.category || '',
      'updated_at': now
    };
    Application.Record.CreateRecords({
      SheetId: sheet.id,
      Records: [{ fields: createFields }]
    });
    return { success: true, action: 'created', cloud_version_time: now };
  }
}

function listPluginSyncs(data) {
  var sheet = getSheetByName('plugin_sync_registry');
  if (!sheet) return { success: false, error: 'Table plugin_sync_registry not found' };

  var records = fetchAllRecords(sheet.id);
  var result = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r.fields) continue;
    if (data && data.category && r.fields['category'] !== data.category) continue;
    result.push({
      sync_id: r.fields['sync_id'],
      sync_type: r.fields['sync_type'],
      cloud_version_time: r.fields['cloud_version_time'],
      description: r.fields['description'],
      category: r.fields['category'],
      updated_at: r.fields['updated_at']
    });
  }
  return { success: true, data: result };
}

function deletePluginSync(data) {
  var sheet = getSheetByName('plugin_sync_registry');
  if (!sheet) return { success: false, error: 'Table plugin_sync_registry not found' };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    if (records[i].fields && records[i].fields['sync_id'] === data.sync_id) {
      Application.Record.DeleteRecords({ SheetId: sheet.id, RecordIds: [records[i].id] });
      return { success: true };
    }
  }
  return { success: false, error: 'Record not found' };
}

// ==================== 文档级同步 ====================

function getDocSync(data) {
  var sheet = getSheetByName('note_sync_registry');
  if (!sheet) return { success: true, data: null };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields &&
        r.fields['sync_block_id'] === data.sync_block_id &&
        r.fields['note_path'] === data.note_path) {
      return {
        success: true,
        data: {
          cloud_version_time: r.fields['cloud_version_time'],
          local_version_time: r.fields['local_version_time'],
          block_content: r.fields['block_content'],
          sync_status: r.fields['sync_status'],
          conflict_resolution: r.fields['conflict_resolution']
        }
      };
    }
  }
  return { success: true, data: null };
}

function upsertDocSync(data) {
  var sheet = getSheetByName('note_sync_registry');
  if (!sheet) return { success: false, error: 'Table note_sync_registry not found' };

  var now = formatDateTime(new Date());
  var records = fetchAllRecords(sheet.id);
  var existingId = null;

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields &&
        r.fields['sync_block_id'] === data.sync_block_id &&
        r.fields['note_path'] === data.note_path) {
      existingId = r.id;
      break;
    }
  }

  if (existingId) {
    Application.Record.UpdateRecords({
      SheetId: sheet.id,
      Records: [{
        id: existingId,
        fields: {
          'local_version_time': data.local_version_time,
          'cloud_version_time': data.local_version_time,
          'block_content': data.block_content,
          'sync_status': 'synced',
          'last_sync_time': now,
          'conflict_resolution': data.conflict_resolution || 'localWins'
        }
      }]
    });
    return { success: true, action: 'updated' };
  } else {
    Application.Record.CreateRecords({
      SheetId: sheet.id,
      Records: [{
        fields: {
          'sync_block_id': data.sync_block_id,
          'note_path': data.note_path,
          'sync_type': data.sync_type || 'inline',
          'local_version_time': data.local_version_time,
          'cloud_version_time': data.local_version_time,
          'block_content': data.block_content,
          'sync_status': 'synced',
          'conflict_resolution': data.conflict_resolution || 'localWins',
          'last_sync_time': now
        }
      }]
    });
    return { success: true, action: 'created' };
  }
}

function pullCloudContent(data) {
  var sheet = getSheetByName('note_sync_registry');
  if (!sheet) return { success: false, error: 'Table note_sync_registry not found' };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields &&
        r.fields['sync_block_id'] === data.sync_block_id &&
        r.fields['note_path'] === data.note_path) {
      var updateFields = {
        'sync_status': 'synced',
        'last_sync_time': formatDateTime(new Date())
      };
      if (data.new_local_version_time) {
        updateFields['local_version_time'] = data.new_local_version_time;
      }
      Application.Record.UpdateRecords({
        SheetId: sheet.id,
        Records: [{ id: r.id, fields: updateFields }]
      });
      return {
        success: true,
        data: {
          block_content: r.fields['block_content'],
          cloud_version_time: r.fields['cloud_version_time']
        }
      };
    }
  }
  return { success: false, error: 'Record not found' };
}

function markConflict(data) {
  var sheet = getSheetByName('note_sync_registry');
  if (!sheet) return { success: false, error: 'Table note_sync_registry not found' };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields &&
        r.fields['sync_block_id'] === data.sync_block_id &&
        r.fields['note_path'] === data.note_path) {
      Application.Record.UpdateRecords({
        SheetId: sheet.id,
        Records: [{
          id: r.id,
          fields: {
            'sync_status': 'conflict',
            'local_version_time': data.local_version_time
          }
        }]
      });
      return { success: true };
    }
  }
  return { success: false, error: 'Record not found' };
}

// ==================== 内容库 ====================

function queryContentByUUID(data) {
  var sheet = getSheetByName('content_library');
  if (!sheet) return { success: false, error: 'Table content_library not found' };

  var records = fetchAllRecords(sheet.id);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.fields && r.fields['uuid'] === data.uuid) {
      var metadata = {};
      try { metadata = JSON.parse(r.fields['metadata'] || '{}'); } catch(e) {}
      return {
        success: true,
        data: {
          uuid: r.fields['uuid'],
          category: r.fields['category'],
          title: r.fields['title'],
          content: r.fields['content'],
          metadata: metadata,
          tags: r.fields['tags'],
          url: r.fields['url']
        }
      };
    }
  }
  return { success: false, error: 'Content not found' };
}

function listContentByCategory(data) {
  var sheet = getSheetByName('content_library');
  if (!sheet) return { success: false, error: 'Table content_library not found' };

  var records = fetchAllRecords(sheet.id);
  var result = [];
  var count = 0;
  var skip = (data && data.offset) || 0;

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r.fields) continue;
    if (r.fields['category'] !== data.category) continue;
    if (skip > 0) { skip--; continue; }
    result.push({
      uuid: r.fields['uuid'],
      title: r.fields['title'],
      tags: r.fields['tags']
    });
    count++;
    if (data && data.limit && count >= data.limit) break;
  }
  return { success: true, data: result };
}

// ==================== 发布记录 ====================

function insertPublishRecord(data) {
  var sheet = getSheetByName('publish_records');
  if (!sheet) return { success: false, error: 'Table publish_records not found' };

  var createFields = {
    'file_name': data.file_name,
    'publish_time': formatDateTime(new Date()),
    'target_branch': data.target_branch,
    'status': data.status
  };
  if (data.vuepress_path) createFields['vuepress_path'] = data.vuepress_path;
  if (data.error_message) createFields['error_message'] = data.error_message;

  var result = Application.Record.CreateRecords({
    SheetId: sheet.id,
    Records: [{ fields: createFields }]
  });
  var recordId = result && result[0] ? result[0].id : '';
  return { success: true, recordId: recordId };
}

// ==================== 初始化 ====================

function initTables() {
  var existing = [];
  var sheets = Application.Sheet.GetSheets();
  for (var i = 0; i < sheets.length; i++) {
    existing.push(sheets[i].name);
  }
  var created = [];

  if (existing.indexOf('plugin_sync_registry') === -1) {
    Application.Sheet.CreateSheet({
      Name: 'plugin_sync_registry',
      Views: [{ name: 'Grid', type: 'Grid' }],
      Fields: [
        { name: 'sync_id', type: 'MultiLineText' },
        { name: 'sync_type', type: 'SingleSelect', items: [{ value: 'inline' }, { value: 'codeblock' }] },
        { name: 'cloud_version_time', type: 'MultiLineText' },
        { name: 'sync_content', type: 'MultiLineText' },
        { name: 'description', type: 'MultiLineText' },
        { name: 'category', type: 'MultiLineText' },
        { name: 'updated_at', type: 'MultiLineText' }
      ]
    });
    created.push('plugin_sync_registry');
  }

  if (existing.indexOf('note_sync_registry') === -1) {
    Application.Sheet.CreateSheet({
      Name: 'note_sync_registry',
      Views: [{ name: 'Grid', type: 'Grid' }],
      Fields: [
        { name: 'sync_block_id', type: 'MultiLineText' },
        { name: 'note_path', type: 'MultiLineText' },
        { name: 'sync_type', type: 'SingleSelect', items: [{ value: 'inline' }, { value: 'codeblock' }] },
        { name: 'cloud_version_time', type: 'MultiLineText' },
        { name: 'local_version_time', type: 'MultiLineText' },
        { name: 'block_content', type: 'MultiLineText' },
        { name: 'sync_status', type: 'SingleSelect', items: [{ value: 'synced' }, { value: 'pending_cloud' }, { value: 'pending_local' }, { value: 'conflict' }] },
        { name: 'conflict_resolution', type: 'SingleSelect', items: [{ value: 'localWins' }, { value: 'cloudWins' }, { value: 'manual' }] },
        { name: 'last_sync_time', type: 'MultiLineText' }
      ]
    });
    created.push('note_sync_registry');
  }

  if (existing.indexOf('content_library') === -1) {
    Application.Sheet.CreateSheet({
      Name: 'content_library',
      Views: [{ name: 'Grid', type: 'Grid' }],
      Fields: [
        { name: 'uuid', type: 'MultiLineText' },
        { name: 'category', type: 'SingleSelect', items: [{ value: 'video' }, { value: 'image' }, { value: 'doc' }, { value: 'template' }] },
        { name: 'title', type: 'MultiLineText' },
        { name: 'content', type: 'MultiLineText' },
        { name: 'metadata', type: 'MultiLineText' },
        { name: 'tags', type: 'MultiLineText' },
        { name: 'url', type: 'Url' },
        { name: 'is_active', type: 'Checkbox' }
      ]
    });
    created.push('content_library');
  }

  if (existing.indexOf('publish_records') === -1) {
    Application.Sheet.CreateSheet({
      Name: 'publish_records',
      Views: [{ name: 'Grid', type: 'Grid' }],
      Fields: [
        { name: 'file_name', type: 'MultiLineText' },
        { name: 'publish_time', type: 'MultiLineText' },
        { name: 'target_branch', type: 'MultiLineText' },
        { name: 'status', type: 'SingleSelect', items: [{ value: 'pending' }, { value: 'success' }, { value: 'failed' }] },
        { name: 'vuepress_path', type: 'MultiLineText' },
        { name: 'error_message', type: 'MultiLineText' }
      ]
    });
    created.push('publish_records');
  }

  return { success: true, created: created };
}

// ==================== KSDrive 云文档 API ====================

function ksdListFiles(data) {
  var opts = {};
  if (data.dirUrl) opts.dirUrl = data.dirUrl;
  if (data.offset !== undefined) opts.offset = data.offset;
  if (data.count !== undefined) opts.count = data.count;
  if (data.includeExts && data.includeExts.length > 0) opts.includeExts = data.includeExts;
  try {
    var result = KSDrive.listFiles(opts);
    var extMap = {
      'ksheet': '智能表格',
      'et': 'WPS 表格',
      'db': '多维表',
      'otl': '文档',
      'wpp': '演示',
      'wps': 'WPS 文字',
      'ap': '智能文档'
    };
    if (result && result.files) {
      for (var i = 0; i < result.files.length; i++) {
        var f = result.files[i];
        var name = f.fileName || '';
        var dotIdx = name.lastIndexOf('.');
        var ext = dotIdx >= 0 ? name.substring(dotIdx + 1).toLowerCase() : '';
        f.fileExt = ext;
        if (!ext) {
          f.isFolder = true;
          f.fileType = '文件夹';
        } else {
          f.isFolder = false;
          f.fileType = extMap[ext] || ext;
        }
      }
    }
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: 'KSDrive.listFiles 失败: ' + e.message };
  }
}

function ksdOpenFile(data) {
  try {
    var file = KSDrive.openFile(data.url);
    var info = { opened: true };

    try { info.fileName = file.Name || ''; } catch (e) {}
    try { info.filePath = file.FullName || ''; } catch (e) {}

    try {
      var app = file.Application;
      try { info.appName = app.Name || ''; } catch (e) {}
      try {
        var sheetCount = app.Sheets.Count;
        info.sheetCount = sheetCount;
        info.sheets = [];
        for (var i = 1; i <= sheetCount; i++) {
          var s = app.Sheets.Item(i);
          var sheetInfo = { name: s.Name || '' };
          try { sheetInfo.usedRange = s.UsedRange.Address || ''; } catch (e) {}
          info.sheets.push(sheetInfo);
        }
      } catch (e) {
        info.sheetsError = e.message;
      }

      try {
        var activeSheet = app.ActiveSheet;
        info.activeSheet = activeSheet.Name || '';
        try {
          var usedRange = activeSheet.UsedRange;
          var lastRow = usedRange.Row + usedRange.Rows.Count - 1;
          var lastCol = usedRange.Column + usedRange.Columns.Count - 1;
          info.usedRange = { address: usedRange.Address, lastRow: lastRow, lastCol: lastCol };
        } catch (e) {
          info.usedRangeError = e.message;
        }
        try {
          info.a1Text = activeSheet.Range('A1').Text;
        } catch (e) {
          info.a1Error = e.message;
        }
      } catch (e) {
        info.activeSheetError = e.message;
      }
    } catch (e) {
      info.appError = e.message;
    }

    try { file.close(); info.closed = true; } catch (e) { info.closeError = e.message; }
    return { success: true, data: info };
  } catch (e) {
    return { success: false, error: 'KSDrive.openFile 失败: ' + e.message };
  }
}

function ksdCreateFile(data) {
  try {
    var type = data.type || 'ET';
    var createOpts = data.createOptions || {};
    var url = KSDrive.createFile(KSDrive.FileType[type], createOpts);
    return { success: true, data: { url: url } };
  } catch (e) {
    return { success: false, error: 'KSDrive.createFile 失败: ' + e.message };
  }
}

function ksdGetOvcpDict(data) {
  var url = data.url;
  if (!url) return { success: false, error: '缺少 url 参数' };
  var viewName = data.viewName || 'OVCP';

  try {
    var file = KSDrive.openFile(url);
    var app = file.Application;
    var result = { viewName: viewName, sheets: [], totalRecords: 0, records: [] };

    var sheetsInfo = [];
    try {
      sheetsInfo = app.Sheet.GetSheets();
    } catch (e) {
      try {
        for (var si = 1; si <= app.Sheets.Count; si++) {
          var s = app.Sheets.Item(si);
          sheetsInfo.push({ id: s.Id, name: s.Name });
        }
      } catch (e2) {
        file.close();
        return { success: false, error: '无法获取数据表列表: ' + e.message + ' / ' + e2.message };
      }
    }

    var fieldMap = {};
    var allSheetViews = [];
    for (var i = 0; i < sheetsInfo.length; i++) {
      var sheetItem = sheetsInfo[i];
      var sheetId = sheetItem.id || sheetItem.Id;
      var sheetName = sheetItem.name || sheetItem.Name;
      var views = sheetItem.views || [];
      var fields = sheetItem.fields || [];

      var sheetFieldMap = {};
      for (var fi = 0; fi < fields.length; fi++) {
        var field = fields[fi];
        var fid = field.id || field.Id;
        var fname = field.name || field.Name;
        if (fid) sheetFieldMap[fid] = fname;
      }
      fieldMap[sheetId] = sheetFieldMap;

      var matchedViews = [];
      var viewNames = [];
      for (var vi = 0; vi < views.length; vi++) {
        var v = views[vi];
        var vname = v.name || v.Name || '';
        var vid = v.id || v.Id || '';
        viewNames.push({ id: vid, name: vname });
        if (vname === viewName) {
          matchedViews.push({ id: vid, name: vname });
        }
      }
      allSheetViews.push({ sheetId: sheetId, sheetName: sheetName, views: viewNames });

      if (matchedViews.length > 0) {
        result.sheets.push({ sheetId: sheetId, sheetName: sheetName, views: matchedViews });

        for (var mvi = 0; mvi < matchedViews.length; mvi++) {
          var mv = matchedViews[mvi];
          try {
            var offset = '';
            var pageSize = 1000;
            while (true) {
              var opts = { SheetId: sheetId, ViewId: mv.id, PageSize: pageSize };
              if (offset) opts.Offset = offset;
              var recResult = app.Record.GetRecords(opts);
              var recs = recResult.records || recResult.Records || [];
              for (var ri = 0; ri < recs.length; ri++) {
                var rec = recs[ri];
                var row = { _sheetId: sheetId, _sheetName: sheetName, _viewId: mv.id, _viewName: mv.name, _recordId: rec.id || rec.Id || '' };
                var fields2 = rec.fields || rec.Fields || {};
                var keys = Object.keys(fields2);
                for (var ki = 0; ki < keys.length; ki++) {
                  var fk = keys[ki];
                  var displayName = fieldMap[sheetId] && fieldMap[sheetId][fk] ? fieldMap[sheetId][fk] : fk;
                  var val = fields2[fk];
                  if (val && typeof val === 'object') {
                    if (val.text !== undefined) {
                      row[displayName] = val.text;
                    } else if (val.name !== undefined) {
                      row[displayName] = val.name;
                    } else if (Array.isArray(val)) {
                      row[displayName] = val.map(function(item) {
                        return item.text || item.name || item.value || String(item);
                      }).join(', ');
                    } else {
                      row[displayName] = JSON.stringify(val);
                    }
                  } else {
                    row[displayName] = val;
                  }
                }
                result.records.push(row);
              }
              result.totalRecords += recs.length;
              var nextOffset = recResult.offset || recResult.Offset;
              if (!nextOffset) break;
              offset = nextOffset;
              if (result.totalRecords >= 5000) break;
            }
          } catch (e) {
            result.sheets[result.sheets.length - 1].views[mvi].error = e.message;
          }
        }
      }
    }

    try { file.close(); } catch (e) {}
    if (result.sheets.length === 0 && allSheetViews.length > 0) {
      result.noMatch = true;
      result.allSheetViews = allSheetViews;
    }
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: 'ksdGetOvcpDict 失败: ' + e.message };
  }
}

// ==================== 主入口 ====================

var argv = Context.argv;
var action = argv.action;
var data = argv.data || {};

switch (action) {
  case 'ping': return { success: true, message: 'pong' };
  case 'getPluginSync': return getPluginSync(data);
  case 'upsertPluginSync': return upsertPluginSync(data);
  case 'listPluginSyncs': return listPluginSyncs(data);
  case 'deletePluginSync': return deletePluginSync(data);

  case 'getDocSync': return getDocSync(data);
  case 'upsertDocSync': return upsertDocSync(data);
  case 'pullCloudContent': return pullCloudContent(data);
  case 'markConflict': return markConflict(data);

  case 'queryContentByUUID': return queryContentByUUID(data);
  case 'listContentByCategory': return listContentByCategory(data);

  case 'insertPublishRecord': return insertPublishRecord(data);

  case 'initTables': return initTables();

  case 'ksdListFiles': return ksdListFiles(data);
  case 'ksdOpenFile': return ksdOpenFile(data);
  case 'ksdCreateFile': return ksdCreateFile(data);
  case 'ksdGetOvcpDict': return ksdGetOvcpDict(data);

  default: return { success: false, error: 'Unknown action: ' + action };
}
