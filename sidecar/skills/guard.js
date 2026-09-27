/* sidecar/skills/guard.js - static guard for runtime/external skill packages.

   The scanner is intentionally regex-based and deterministic. It catches
   common prompt-injection, exfiltration, destructive command, persistence,
   and obfuscation patterns before a skill package is trusted.

   Extended 2026-09-27 (credential access · self-protection evasion · remote
   control · escalation · scheduled persistence). The threat TAXONOMY for the
   additions came from comparing this scanner against skill-firewall, the
   standalone predecessor of this module that still sits in the workspace: its
   own shipped malicious sample reads ~/.ssh/id_rsa and silences telemetry, and
   neither shape was matched by any pattern here. Eight of twelve named threat
   classes scanned as SAFE before this change (see docs/PHASE0-AUDIT-v3.md §12).
*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).skillGuard = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TRUST = {
    builtin: { safe: 'allow', caution: 'allow', dangerous: 'allow' },
    trusted: { safe: 'allow', caution: 'allow', dangerous: 'block' },
    // Community procedures commonly contain URLs or setup scripts. Those are inspectable cautions,
    // not automatic malware: install them withheld and bind the Commander's approval to exact bytes.
    // High/critical findings remain an outright block.
    community: { safe: 'allow', caution: 'ask', dangerous: 'block' },
    'agent-created': { safe: 'allow', caution: 'allow', dangerous: 'ask' },
    /* THE COMMANDER IS THE APPROVER, SO THEY GET ASK — NOT BLOCK. A skill the human typed into
       the SKILLS panel used to be scanned as 'trusted', whose answer for dangerous content is
       block; with the gate now enforcing verdicts that made a dead end — you write `rm -rf` into
       your own local procedure on purpose, and the only surface that could bless it is the one
       refusing you, with no key anywhere ("sandbox, no gating" cuts against that). 'trusted'
       still means what it says for content that arrives claiming to be vetted by someone else
       (a future hub install), where a dangerous pattern is evidence the claim is false. */
    user: { safe: 'allow', caution: 'allow', dangerous: 'ask' }
  };
  const ORDER = { safe: 0, caution: 1, dangerous: 2 };
  const PATTERNS = [
    [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'env_exfil_curl', 'critical', 'exfiltration', 'curl command interpolating a secret env var'],
    [/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'env_exfil_wget', 'critical', 'exfiltration', 'wget command interpolating a secret env var'],
    [/fetch\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD|API)/i, 'env_exfil_fetch', 'high', 'exfiltration', 'fetch call mentioning secret material'],
    [/requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)/i, 'env_exfil_requests', 'high', 'exfiltration', 'requests call mentioning secret material'],
    [/ignore (all )?(previous|prior|system|developer) instructions/i, 'ignore_instructions', 'high', 'injection', 'instruction override request'],
    [/reveal (the )?(system|developer) prompt/i, 'reveal_prompt', 'high', 'injection', 'prompt disclosure request'],
    [/rm\s+-rf\s+(\/|\$HOME|~|\.)/i, 'rm_rf', 'critical', 'destructive', 'destructive recursive removal'],
    [/Remove-Item\s+.*-Recurse\s+.*-Force/i, 'ps_remove_recurse', 'critical', 'destructive', 'destructive PowerShell removal'],
    [/>+\s*~\/\.(bashrc|zshrc|profile|powershell)/i, 'shell_profile_persist', 'medium', 'persistence', 'shell profile persistence'],
    [/\b(base64|fromCharCode|eval|Invoke-Expression)\b/i, 'obfuscation_eval', 'medium', 'obfuscation', 'obfuscation or dynamic execution'],
    [/https?:\/\/[^\s`'")]+/i, 'network_url', 'low', 'network', 'embedded network URL'],

    /* ============ THE CLASSES A DETERMINISTIC SCANNER WAS MISSING (2026-09-27) ============
       Every rule below closes a gap found by running twelve named threat classes through this
       scanner: eight scanned as SAFE, including the two shapes in skill-firewall's own shipped
       malicious sample. Severity is chosen so the TRUST table stays honest rather than maximally
       alarming — a credential file read is `critical` (no procedure does that), while merely
       READING a secret-shaped env var is `medium` (a skill that calls its own API has a
       legitimate shape) and therefore lands in `ask` for community content, not `block`. */
    // private key material — an SSH private key filename has no benign role in a skill
    [/\b(id_rsa|id_ed25519|id_ecdsa)\b/i, 'private_key_ref', 'critical', 'credential-access', 'references an SSH private key file'],
    // a credential STORE opened by path (the verb is required, so prose that merely names one is not flagged)
    [/(readFileSync|readFile|Get-Content|\bcat\s|\bopen\s*\()\s*[^\n]{0,60}(\.ssh|\.aws|\.netrc|\.pgpass|\.git-credentials|\.kube|\.docker[\/\\]config\.json)/i, 'credential_store_read', 'critical', 'credential-access', 'reads a credential store by path'],
    // a secret-shaped env var READ (not merely interpolated into curl — that is env_exfil_* above)
    [/(process\.env|os\.environ|\$env:|getenv\s*\()[^\n]{0,14}(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i, 'secret_env_read', 'medium', 'credential-access', 'reads a secret-shaped environment variable'],

    /* ---- SELF-PROTECTION EVASION ------------------------------------------------------------
       ⛔ THE MOST IMPORTANT ADDITION. A skill that turns off the audit trail, the consent broker,
          or THIS scanner is attacking the mechanism that would report it — and no pattern here
          covered it, so `fs.appendFileSync = () => {}` scanned as SAFE. `high`/`critical` is
          deliberate: nothing legitimate reconfigures the guard from inside a skill. */
    [/(console\.(log|error|warn|info)\s*=\s*(\(\)\s*=>|function|null|noop)|logger\.disabled\s*=\s*true|logging\.(disable|enabled\s*=\s*false))/i, 'disable_logging', 'high', 'evasion', 'silences logging from inside the skill'],
    [/((appendFileSync|writeFileSync|logDecision|auditLog|activityStore)\s*=\s*(\(\)\s*=>|function|null))|(audit\w*\.(disabled|enabled)\s*=\s*(true|false))/i, 'disable_audit', 'high', 'evasion', 'disables or nulls the audit trail'],
    [/(skillGuard|SKILL_GUARD\w*|skillGate|guardAction|scanSkillRecord)\s*=\s*(null|false|undefined|\(\)\s*=>|\{\})/i, 'disable_guard', 'critical', 'evasion', 'disables or nulls the skill guard itself'],
    [/(permissions?\.(bypass|disabled|enabled)\s*=\s*(true|false)|bypassPermissions|skipConsent|requireConsent\s*=\s*false|autoApprove\s*=\s*true)/i, 'bypass_consent', 'critical', 'evasion', 'bypasses the consent / permission gate'],
    [/--no-(audit|verify|sandbox|permission)\b/i, 'disable_flags', 'high', 'evasion', 'passes a flag that disables a safety mechanism'],

    /* ---- REMOTE CONTROL · ESCALATION · SCHEDULED PERSISTENCE --------------------------------- */
    [/(\/dev\/tcp\/|\bnc\s+(-e|--exec)|\bncat\s+(-e|--exec)|socat\s+[^\n]*exec|bash\s+-i\s*>&)/i, 'reverse_shell', 'critical', 'remote-control', 'reverse shell or remote command channel'],
    [/(chmod\s+(\+s|u\+s|g\+s|777\s+[\/.])|setcap\s|NOPASSWD|\/etc\/sudoers)/i, 'privilege_escalation', 'high', 'escalation', 'privilege escalation or a world-writable critical path'],
    [/(crontab\s+-|@reboot|\/etc\/cron|systemctl\s+enable|launchctl\s+load|LaunchAgents|schtasks\s+\/create)/i, 'scheduled_persistence', 'high', 'persistence', 'installs a scheduled or boot-time persistence hook'],

    /* ---- OBFUSCATED EXECUTION, NARROWED ------------------------------------------------------
       `obfuscation_eval` above stays `medium` because a bare `eval` has innocent uses; the
       COMBINATION of dynamic decode plus execution is the shape that never is. */
    [/(eval|Function|exec)\s*\([^\n]*(base64|atob|fromCharCode|unescape|decode)/i, 'obfuscated_exec', 'critical', 'obfuscation', 'executes dynamically decoded code']
  ];
  const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

  function str(v) { return v == null ? '' : String(v); }
  function verdictFor(findings) {
    let max = 0;
    for (const f of findings) max = Math.max(max, SEV_RANK[f.severity] || 0);
    if (max >= 3) return 'dangerous';
    if (max >= 1) return 'caution';
    return 'safe';
  }
  function scanText(file, content) {
    const findings = [];
    const lines = str(content).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/.test(line)) {
        findings.push({ patternId: 'invisible_unicode', severity: 'medium', category: 'obfuscation', file, line: i + 1, match: '', description: 'invisible Unicode control character' });
      }
      for (const p of PATTERNS) {
        const m = p[0].exec(line);
        if (m) findings.push({ patternId: p[1], severity: p[2], category: p[3], file, line: i + 1, match: str(m[0]).slice(0, 160), description: p[4] });
      }
    }
    return findings;
  }
  function scanSkillRecord(skill, opts) {
    opts = opts || {};
    const source = opts.source || skill.createdBy || 'agent-created';
    const files = Array.isArray(skill.files) ? skill.files : [];
    let findings = scanText('SKILL.md', str(skill.body) + '\n' + str(skill.setup));
    for (const f of files) findings = findings.concat(scanText(str(f.path || 'support-file'), f.content));
    const verdict = verdictFor(findings);
    return {
      skillName: str(skill.name || skill.id || 'skill'),
      source,
      trustLevel: TRUST[source] ? source : 'community',
      verdict,
      findings,
      summary: findings.length ? (findings.length + ' finding(s), verdict=' + verdict) : 'safe'
    };
  }
  function shouldAllow(scan, opts) {
    opts = opts || {};
    if (!scan) return { allow: true, action: 'allow', reason: 'not scanned' };
    const trust = TRUST[scan.trustLevel] || TRUST.community;
    const action = trust[scan.verdict] || 'block';
    if (action === 'allow') return { allow: true, action, reason: scan.summary || 'safe' };
    if (action === 'ask' && opts.allowAsk !== false) return { allow: true, action, reason: scan.summary || 'requires review' };
    return { allow: false, action, reason: scan.summary || 'blocked by skill guard' };
  }
  /* "take the WORSE of two risk levels" — which failed OPEN on anything it did not recognize. ORDER[unknown]
     is undefined, and `undefined >= n` is FALSE, so an unrecognized level always LOST: worse('Dangerous',
     'safe') returned 'safe', and so did any typo, casing difference, or level a newer scanner emits. An
     unknown risk is the one thing that must never be treated as the safer option — rank it above every known
     level so it wins, and normalize case so a spelling difference is not a downgrade. */
  function rankOf(v) {
    const k = String(v == null ? '' : v).trim().toLowerCase();
    if (!k) return ORDER.safe;
    return Object.prototype.hasOwnProperty.call(ORDER, k) ? ORDER[k] : Infinity;   // unknown = worst
  }
  function worse(a, b) { return rankOf(a) >= rankOf(b) ? a : b; }

  return { scanText, scanSkillRecord, shouldAllow, worse, TRUST };
});
