#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'n8n', 'workflows', 'Real Estate AI Agent.json');
const semverPattern = /^\d+\.\d+\.\d+$/;
const workflowName = 'Real Estate AI Agent';
const workflowFile = 'n8n/workflows/Real Estate AI Agent.json';
const stickyNodeId = 'workflow-version-banner';
const metadataNodeId = 'workflow-metadata-node';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function assertSemver(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid version \"${version}\". Expected x.y.z.`);
  }
}

function buildStickyContent(versionInfo) {
  return [
    `## ${workflowName}`,
    '',
    `**Version:** \`${versionInfo.version}\``,
    `**Git SHA:** \`${versionInfo.gitSha}\``,
    `**Built:** \`${versionInfo.buildDate}\``,
    '',
    'Upload check:',
    `- workflow name is \`${workflowName}\``,
    `- metadata node is \`Workflow Metadata - v${versionInfo.version}\``,
  ].join('\n');
}

function buildMetadataCode(versionInfo) {
  const payload = {
    workflow_name: workflowName,
    workflow_version: versionInfo.version,
    workflow_display_name: workflowName,
    git_sha: versionInfo.gitSha,
    build_date: versionInfo.buildDate,
    workflow_file: workflowFile,
    version_source: workflowFile,
  };

  const payloadJson = JSON.stringify(payload, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');

  return `return [{\n  json: ${payloadJson}\n}];`;
}

function upsertStickyNode(workflow, versionInfo) {
  const stickyNode = {
    id: stickyNodeId,
    name: 'Workflow Version Banner',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [19840, 5952],
    parameters: {
      content: buildStickyContent(versionInfo),
      height: 240,
      width: 560,
      color: 4,
    },
  };

  const existingIndex = workflow.nodes.findIndex(
    (node) => node.id === stickyNodeId || node.name === stickyNode.name,
  );

  if (existingIndex === -1) {
    workflow.nodes.push(stickyNode);
    return;
  }

  workflow.nodes[existingIndex] = {
    ...workflow.nodes[existingIndex],
    ...stickyNode,
    parameters: {
      ...(workflow.nodes[existingIndex].parameters || {}),
      ...stickyNode.parameters,
    },
  };
}

function upsertMetadataNode(workflow, versionInfo) {
  const metadataNode = {
    id: metadataNodeId,
    name: `Workflow Metadata - v${versionInfo.version}`,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [20480, 5952],
    parameters: {
      jsCode: buildMetadataCode(versionInfo),
    },
  };

  const existingIndex = workflow.nodes.findIndex(
    (node) => node.id === metadataNodeId || String(node.name || '').startsWith('Workflow Metadata - v'),
  );

  if (existingIndex === -1) {
    workflow.nodes.push(metadataNode);
    return;
  }

  workflow.nodes[existingIndex] = {
    ...workflow.nodes[existingIndex],
    ...metadataNode,
    parameters: {
      ...(workflow.nodes[existingIndex].parameters || {}),
      ...metadataNode.parameters,
    },
  };
}

function main() {
  const requestedVersion = process.argv[2];
  const workflow = readJson(workflowPath);
  const existingMetadataNode = workflow.nodes.find(
    (node) => node.id === metadataNodeId || String(node.name || '').startsWith('Workflow Metadata - v'),
  );
  const existingVersion =
    existingMetadataNode && String(existingMetadataNode.name || '').match(/Workflow Metadata - v(\d+\.\d+\.\d+)$/)?.[1];
  const version = requestedVersion ?? existingVersion ?? '1.0.0';

  assertSemver(version);

  const versionInfo = {
    version,
    buildDate: new Date().toISOString().slice(0, 10),
    gitSha: getGitSha(),
  };

  workflow.name = workflowName;
  upsertStickyNode(workflow, versionInfo);
  upsertMetadataNode(workflow, versionInfo);

  writeJson(workflowPath, workflow);

  process.stdout.write(`Stamped ${workflowName} v${versionInfo.version} (${versionInfo.gitSha})\n`);
}

main();
