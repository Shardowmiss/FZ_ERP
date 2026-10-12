#!/usr/bin/env node
// FULLSTACK_PRECOMMIT_V1
'use strict';

const { spawnSync } = require('node:child_process');

const SEP = '  ' + '─'.repeat(36);

function failAndExit(step, body) {
  process.stderr.write('\n✗ pre-commit failed: ' + step + '\n');
  process.stderr.write(SEP + '\n');
  if (body && body.length > 0) {
    process.stderr.write(body.replace(/\s+$/, '') + '\n');
  }
  process.stderr.write(SEP + '\n');
  process.stderr.write('  bypass: git commit --no-verify\n');
  process.exit(1);
}

function runNpm(step, args) {
  const cwd = process.cwd();
  const res = spawnSync('npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (res.error) {
    failAndExit(step, String(res.error.message || res.error));
  }
  if (res.status !== 0) {
    const stdout = res.stdout ? res.stdout.toString() : '';
    const stderr = res.stderr ? res.stderr.toString() : '';
    failAndExit(step, stdout + '\n' + stderr);
  }
}

// 权限一致性门禁（#811 种子卫生）：静态、无需数据库，防止播种/守卫/路由/菜单
// 声明了目录中不存在的权限码（新部署静默缺权限 / 接口对所有人 403）。
// 前置执行（快）：先给出权限信号，再跑较慢的 lint。
runNpm('perm:check', ['run', 'perm:check']);
runNpm('lint', ['run', 'lint']);
