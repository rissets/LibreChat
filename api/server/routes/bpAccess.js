const axios = require('axios');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { nanoid } = require('nanoid');
const {
  AccessRoleIds,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const { Agent, Skill } = require('~/db/models');
const db = require('~/models');
const { grantPermission } = require('~/server/services/PermissionService');

const router = express.Router();

const SKILL_LIBRARY = {
  'official-correspondence': {
    title: 'Korespondensi Dinas',
    description: 'Menyusun surat, nota dinas, dan memo dengan bahasa administrasi yang jelas.',
    body: 'Identifikasi tujuan, penerima, dasar atau konteks, keputusan yang diminta, penanggung jawab, serta tenggat. Gunakan Bahasa Indonesia baku, ringkas, dan jangan mengarang nomor maupun dasar hukum.',
  },
  'executive-brief': {
    title: 'Ringkasan Eksekutif',
    description: 'Mengubah materi panjang menjadi ringkasan keputusan untuk pimpinan.',
    body: 'Susun konteks, temuan utama, opsi, risiko, rekomendasi, dan keputusan yang dibutuhkan. Bedakan fakta, asumsi, dan data yang masih perlu diverifikasi.',
  },
  'evidence-summary': {
    title: 'Ringkasan Berbasis Bukti',
    description: 'Merangkum sumber dengan sitasi, batasan, dan tingkat keyakinan.',
    body: 'Gunakan hanya bukti yang tersedia. Cantumkan sumber di dekat klaim, tanggal relevan, perbedaan antar-sumber, batasan data, dan pertanyaan lanjutan.',
  },
  'spreadsheet-analysis': {
    title: 'Analisis Spreadsheet',
    description: 'Memeriksa CSV/XLSX, kualitas data, metrik, anomali, dan rekomendasi.',
    body: 'Mulai dengan profil kolom dan kualitas data. Jelaskan rumus, asumsi, missing value, outlier, rekonsiliasi total, lalu sajikan tabel ringkas dan rekomendasi yang dapat ditindaklanjuti.',
  },
  'document-drafting': {
    title: 'Penyusunan Dokumen',
    description: 'Menyusun DOCX-ready brief, laporan, SOP, dan kerangka kebijakan.',
    body: 'Tanyakan audiens dan tujuan jika belum jelas. Susun judul, ringkasan, ruang lingkup, isi bernomor, pemilik aksi, tenggat, lampiran, dan daftar hal yang harus diverifikasi.',
  },
  'presentation-briefing': {
    title: 'Brief Presentasi',
    description: 'Menyusun alur slide dan pesan utama untuk rapat atau paparan.',
    body: 'Buat satu pesan utama per slide, judul berbasis kesimpulan, bukti pendukung, catatan pembicara, dan keputusan yang diharapkan. Hindari slide padat teks.',
  },
  'pdf-review': {
    title: 'Telaah PDF',
    description: 'Menelaah dokumen PDF dan mengekstrak kewajiban, risiko, serta tindak lanjut.',
    body: 'Petakan struktur dokumen, kutip bagian penting secara singkat, catat halaman, pihak, tanggal, kewajiban, pengecualian, risiko, dan daftar tindak lanjut.',
  },
  'web-research': {
    title: 'Riset Web Terverifikasi',
    description: 'Melakukan riset web dengan sumber primer dan jejak verifikasi.',
    body: 'Prioritaskan sumber resmi dan primer. Cantumkan tautan serta tanggal, bandingkan sumber bila perlu, jangan menyimpulkan lebih jauh dari bukti, dan tandai informasi yang dapat berubah.',
  },
};
const UNIVERSAL_TOOLS = ['web_research', 'spreadsheet_workflow', 'document_workflow'];
const BUILTIN_TOOLS = ['image_gen_oai'];
const DEFAULT_AGENT_MODEL = 'bp/gpt-5.6-sol-medium';

const DEFAULT_PROFILE = {
  agent: {
    id: 'bp-department-general',
    name: 'Asisten Umum BP Batam',
    description: 'Asisten kerja umum untuk pegawai BP Batam.',
  },
  skills: Object.keys(SKILL_LIBRARY),
  mcp_servers: ['bp-department-tools'],
  tools: ['department_guidance', 'document_checklist', 'integration_directory', 'platform_status', 'web_research', 'spreadsheet_workflow', 'document_workflow', ...BUILTIN_TOOLS],
  model: DEFAULT_AGENT_MODEL,
};

async function grantOwner({ userId, resourceType, resourceId, accessRoleId }) {
  await grantPermission({
    principalType: PrincipalType.USER,
    principalId: userId,
    resourceType,
    resourceId,
    accessRoleId,
    grantedBy: userId,
  });
}

async function ensureDepartmentCapabilities(user, accessData) {
  const userId = user?.id || user?._id;
  if (!userId) return { agents: 0, skills: 0 };
  const profiles = (accessData?.teams || [])
    .map((team) => ({ team, profile: team?.capabilities }))
    .filter((item) => item.profile?.agent);
  if (profiles.length === 0) {
    profiles.push({ team: { code: 'general', name: 'Umum' }, profile: DEFAULT_PROFILE });
  }

  const managedAssets = Array.isArray(accessData?.managed_assets) ? accessData.managed_assets : [];
  const sharedSkillNames = managedAssets
    .filter((asset) => asset.type === 'skill')
    .map((asset) => asset.configuration?.skill_name || asset.name);
  const sharedTools = managedAssets.filter((asset) => asset.type === 'tool').map((asset) => asset.configuration?.tool_name || asset.name);
  const sharedMcpServers = managedAssets.filter((asset) => asset.type === 'mcp').map((asset) => asset.configuration?.server_name).filter(Boolean);
  for (const item of profiles) {
    item.profile.skills = [...new Set([...(item.profile.skills || []), ...Object.keys(SKILL_LIBRARY), ...sharedSkillNames])];
    item.profile.tools = [...new Set([...(item.profile.tools || []), ...UNIVERSAL_TOOLS, ...BUILTIN_TOOLS, ...sharedTools])];
    item.profile.mcp_servers = [...new Set([...(item.profile.mcp_servers || []), ...sharedMcpServers])];
  }
  for (const asset of managedAssets.filter((item) => item.type === 'agent')) {
    profiles.push({
      team: { code: 'managed', name: 'BP Batam' },
      profile: {
        agent: { id: `managed-${asset.id}`, name: asset.name, description: asset.description },
        instructions: asset.instructions,
        model: asset.model,
        skills: [...sharedSkillNames, ...((asset.configuration?.skills) || [])],
        tools: [...sharedTools, ...((asset.configuration?.tools) || [])],
        mcp_servers: [...sharedMcpServers, ...((asset.configuration?.mcp_servers) || [])],
      },
    });
  }

  let agentCount = 0;
  let skillCount = 0;
  for (const { team, profile } of profiles) {
    const skillIds = [];
    for (const skillName of profile.skills || []) {
      let skill = await Skill.findOne({ author: userId, name: skillName });
      const catalogSkill = SKILL_LIBRARY[skillName] || managedAssets.find((asset) => asset.type === 'skill' && asset.name === skillName);
      if (!skill) {
        skill = await Skill.create({
          name: skillName,
          displayTitle: catalogSkill?.title || catalogSkill?.name || skillName.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
          description: catalogSkill?.description || `Gunakan untuk pekerjaan ${team.name || 'BP Batam'} yang membutuhkan ${skillName.replace(/-/g, ' ')}.`,
          body: catalogSkill?.body || catalogSkill?.instructions || `Terapkan metode ${skillName.replace(/-/g, ' ')} secara ringkas. Verifikasi fakta, lindungi data internal, tandai asumsi, dan hasilkan langkah tindak lanjut yang jelas.`,
          category: team.code || 'general',
          author: userId,
          authorName: user.name || user.email || 'BP Batam',
          source: 'inline',
          alwaysApply: false,
          userInvocable: true,
        });
        await grantOwner({ userId, resourceType: ResourceType.SKILL, resourceId: skill._id, accessRoleId: AccessRoleIds.SKILL_OWNER });
      }
      skillIds.push(String(skill._id));
      skillCount += 1;
    }

    const stableAgentId = `${profile.agent.id}-${String(userId).slice(-8)}`;
    let agent = await Agent.findOne({ id: stableAgentId, author: userId });
    const tools = (profile.tools || []).map((tool) =>
      BUILTIN_TOOLS.includes(tool) || tool.includes('_mcp_')
        ? tool
        : `${tool}_mcp_bp-department-tools`,
    );
    const allowedModels = new Set((accessData?.models || []).map((item) => item.model));
    const defaultModel = (profile.model && allowedModels.has(profile.model))
      ? profile.model
      : (allowedModels.has(DEFAULT_AGENT_MODEL)
        ? DEFAULT_AGENT_MODEL
        : ((accessData?.models || [])[0]?.model || DEFAULT_AGENT_MODEL));
    const agentData = {
      name: profile.agent.name,
      description: profile.agent.description,
      instructions: profile.instructions || `Anda adalah ${profile.agent.name}. Bantu pekerjaan ${team.name || 'BP Batam'} dalam Bahasa Indonesia. Gunakan data terverifikasi, jangan mengarang dasar hukum, lindungi informasi internal, tampilkan asumsi, risiko, dan langkah tindak lanjut.`,
      provider: 'BP Batam AI',
      model: defaultModel,
      model_parameters: { model: defaultModel },
      category: team.code || 'general',
      tools,
      mcpServerNames: [...new Set(['bp-department-tools', ...(profile.mcp_servers || [])])],
      skills: skillIds,
      skills_enabled: true,
      artifacts: 'default',
      conversation_starters: [
        'Buat ringkasan eksekutif untuk pekerjaan unit saya.',
        'Susun checklist dokumen dan risiko yang perlu diperiksa.',
        'Bantu siapkan rencana tindak lanjut yang terukur.',
      ],
    };
    if (!agent) {
      agent = await db.createAgent({ id: stableAgentId || nanoid(), author: userId, ...agentData });
      await grantOwner({ userId, resourceType: ResourceType.AGENT, resourceId: agent._id, accessRoleId: AccessRoleIds.AGENT_OWNER });
      await grantOwner({ userId, resourceType: ResourceType.REMOTE_AGENT, resourceId: agent._id, accessRoleId: AccessRoleIds.REMOTE_AGENT_OWNER });
    } else {
      await Agent.updateOne({ _id: agent._id }, { $set: agentData });
    }
    agentCount += 1;
  }
  return { agents: agentCount, skills: skillCount };
}

router.get('/', requireJwtAuth, async (req, res) => {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const email = req.user?.email;

  if (!controlPlaneUrl || !internalServiceToken) {
    return res.status(503).json({ detail: 'access_service_not_configured' });
  }
  if (!email) {
    return res.status(422).json({ detail: 'authenticated_user_email_required' });
  }

  try {
    const sessionKey = String(req.sessionID || req.user?.id || req.user?._id || 'unknown').slice(0, 128);
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.ip || '')
      .split(',')[0]
      .trim()
      .replace(/^::ffff:/, '');
    const response = await axios.post(
      `${controlPlaneUrl.replace(/\/$/, '')}/api/platform/internal/identity/resolve/`,
      { email },
      {
        timeout: 5000,
        headers: { 'X-BP-Internal-Token': internalServiceToken },
      },
    );
    await axios.post(
      `${controlPlaneUrl.replace(/\/$/, '')}/api/platform/internal/session/touch/`,
      {
        email,
        session_key: sessionKey,
        external_user_id: String(req.user?.id || req.user?._id || ''),
        device_name: 'BP Chat Web',
        user_agent: req.headers['user-agent'] || '',
        ip_address: ipAddress || null,
      },
      { timeout: 3000, headers: { 'X-BP-Internal-Token': internalServiceToken } },
    ).catch((sessionError) => {
      logger.warn('[BPAccess] Session device synchronization failed', {
        upstreamStatus: sessionError.response?.status,
        userId: req.user?.id ?? req.user?._id,
      });
    });
    const capabilitySync = await ensureDepartmentCapabilities(req.user, response.data).catch((capabilityError) => {
      logger.warn('[BPAccess] Department capability synchronization failed', {
        userId: req.user?.id ?? req.user?._id,
        error: capabilityError.message,
      });
      return { agents: 0, skills: 0, status: 'degraded' };
    });
    return res.status(200).json({ ...response.data, capability_sync: capabilitySync });
  } catch (error) {
    const upstreamStatus = error.response?.status;
    logger.error('[BPAccess] Unable to load user access summary', {
      upstreamStatus,
      userId: req.user?.id ?? req.user?._id,
    });
    return res.status(upstreamStatus === 404 ? 404 : 502).json({
      detail: upstreamStatus === 404 ? 'identity_not_found' : 'access_service_unavailable',
    });
  }
});

module.exports = router;
