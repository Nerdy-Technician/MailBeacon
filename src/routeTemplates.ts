/**
 * Ready-made routes for common homelab senders. Each one is a starting point: the user picks
 * destinations and can change everything before saving. `confidence` says how sure we are of the
 * mail format: "known" = taken from the sender's source or docs, "partial" = parts confirmed,
 * "guess" = typical format, check against a real message with the preview.
 */
import type { MatchType } from "./db.js";
import type { RouteOptions } from "./format.js";

export interface RouteTemplate {
  id: string; name: string; service: string; description: string;
  confidence: "known" | "partial" | "guess"; notes: string;
  matchType: MatchType; pattern: string;
  options: Pick<RouteOptions, "extract" | "titleTemplate" | "bodyTemplate" | "priorityRules">;
  sample: { from: string; to: string; subject: string; body: string };
}

export const ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    id: "proxmox-vzdump", name: "Proxmox backups", service: "Proxmox VE",
    description: "vzdump backup job results, with the host and result pulled out. Failures go out at high priority.",
    confidence: "known",
    notes: "Subject format \"vzdump backup status (HOST): backup successful|failed\" is what Proxmox VE's legacy mail notifications send. Proxmox VE 8.1+ notification targets can use their own templates; adjust the pattern if you changed them.",
    matchType: "subject", pattern: "^vzdump backup status",
    options: {
      extract: [{ kind: "regex", field: "subject", pattern: "vzdump backup status \\((?<host>[^)]+)\\): (?<result>.+)$" }],
      titleTemplate: "Proxmox {{host|backup}}: {{result|status}}",
      priorityRules: [{ field: "var:result", pattern: "fail|error", priority: 8 }, { field: "var:result", pattern: "success", priority: 2 }],
    },
    sample: { from: "root@pve1.lan", to: "proxmox@alerts.local", subject: "vzdump backup status (pve1.lan): backup failed",
      body: "Details\n=======\nVMID    Name         Status    Time     Size\n101     homeassistant err      00:00:04 0 B\n\nTotal running time: 4s\n\nLogs\n====\nvzdump 101 --storage nas --mode snapshot\n101: ERROR: Backup of VM 101 failed - storage 'nas' is not online" },
  },
  {
    id: "truenas", name: "TrueNAS alerts", service: "TrueNAS",
    description: "Alert emails, with the alert level and the first alert line as the title.",
    confidence: "partial",
    notes: "The body's \"New alerts:\" / \"Current alerts:\" bullet list matches TrueNAS alert mails. The subject (often \"TrueNAS HOST: Critical Alerts\") varies by version, so it is only a guess; the level is read from it when present.",
    matchType: "subject", pattern: "TrueNAS",
    options: {
      extract: [
        { kind: "regex", field: "subject", pattern: "TrueNAS\\s*@?\\s*(?<host>[\\w.-]+)?:?\\s*(?<level>Critical|Warning|Info|Notice|Error)?" },
        { kind: "regex", field: "body", pattern: "New alerts?:\\s*\\n\\s*[*•-]\\s*(?<alert>.+)", name: "alert" },
      ],
      titleTemplate: "TrueNAS {{host}}: {{alert:120|{{subject}}}}",
      priorityRules: [{ field: "var:level", pattern: "critical|error", priority: 8 }, { field: "any", pattern: "DEGRADED|FAULTED|UNAVAIL", priority: 8 }, { field: "var:level", pattern: "warning", priority: 5 }],
    },
    sample: { from: "truenas@nas.lan", to: "truenas@alerts.local", subject: "TrueNAS nas.lan: Critical Alerts",
      body: "TrueNAS @ nas.lan\n\nNew alerts:\n* Pool tank state is DEGRADED: One or more devices has experienced an unrecoverable error.\n\nCurrent alerts:\n* Pool tank state is DEGRADED: One or more devices has experienced an unrecoverable error." },
  },
  {
    id: "unraid", name: "Unraid notifications", service: "Unraid",
    description: "Unraid's notify emails: event, subject, description and importance fields.",
    confidence: "partial",
    notes: "Unraid mail bodies carry \"Event:\", \"Subject:\", \"Description:\" and \"Importance:\" lines (from its notify script). The mail subject prefix depends on your notification settings, so matching on the sender address may suit you better.",
    matchType: "subject", pattern: "Unraid|\\[.+\\]",
    options: {
      extract: [
        { kind: "field", field: "body", pattern: "Event", name: "event" },
        { kind: "field", field: "body", pattern: "Subject", name: "what" },
        { kind: "field", field: "body", pattern: "Description", name: "description" },
        { kind: "field", field: "body", pattern: "Importance", name: "importance" },
      ],
      titleTemplate: "{{what|{{subject}}}}", bodyTemplate: "{{description|{{body}}}}\n\n{{event}}",
      priorityRules: [{ field: "var:importance", pattern: "alert", priority: 8 }, { field: "var:importance", pattern: "warning", priority: 5 }, { field: "var:importance", pattern: "normal", priority: 2 }],
    },
    sample: { from: "unraid@tower.lan", to: "unraid@alerts.local", subject: "Unraid Status: Notice [TOWER] - array health report [PASS]",
      body: "Event: Unraid Status\nSubject: Notice [TOWER] - array health report [PASS]\nDescription: Array has 4 disks (including parity & pools)\nImportance: normal\n\nParity - WDC_WD80 (sdb) - active 31 C [OK]" },
  },
  {
    id: "nut", name: "UPS (NUT)", service: "Network UPS Tools",
    description: "upsmon events (on battery, low battery, power back), with the UPS name and event.",
    confidence: "partial",
    notes: "The messages (\"UPS ups@localhost on battery\", \"... on line power\", \"... battery is low\", \"Communications with UPS ... lost\") are upsmon's default NOTIFYMSG texts. upsmon does not email by itself: the subject depends on your NOTIFYCMD script, so the template reads the event from subject or body.",
    matchType: "subject", pattern: "\\bUPS\\b",
    options: {
      extract: [{ kind: "regex", field: "any", pattern: "UPS (?<ups>[\\w.-]+@[\\w.-]+|[\\w.-]+)[: ]+(?<event>on battery|on line power|battery is low|battery needs to be replaced|forced shutdown in progress|is unavailable|system shutdown in progress)|Communications with UPS (?<lost>[\\w.@-]+) lost" }],
      titleTemplate: "UPS {{ups|{{lost}}}}: {{event|communications lost}}",
      priorityRules: [{ field: "var:event", pattern: "low|shutdown|replaced", priority: 9 }, { field: "var:event", pattern: "on battery", priority: 7 }, { field: "var:lost", pattern: ".", priority: 7 }, { field: "var:event", pattern: "line power", priority: 3 }],
    },
    sample: { from: "nut@pi.lan", to: "ups@alerts.local", subject: "UPS alert", body: "UPS ups@localhost on battery" },
  },
  {
    id: "synology", name: "Synology DSM", service: "Synology",
    description: "DSM notification emails; the device name comes from the [NAME] subject prefix.",
    confidence: "guess",
    notes: "DSM puts the device name in square brackets at the start of the subject by default (\"[DiskStation] ...\"). The wording of each event is a guess and differs between DSM versions and languages; check a real mail with the preview.",
    matchType: "subject", pattern: "^\\[[^\\]]+\\]",
    options: {
      extract: [{ kind: "regex", field: "subject", pattern: "^\\[(?<nas>[^\\]]+)\\]\\s*(?<event>.+)$" }],
      titleTemplate: "{{nas}}: {{event|{{subject}}}}",
      priorityRules: [{ field: "any", pattern: "degraded|crashed|failed|abnormal|bad sector", priority: 8 }, { field: "any", pattern: "warning|almost full|low", priority: 5 }, { field: "any", pattern: "completed|succeeded|success", priority: 2 }],
    },
    sample: { from: "dsm@diskstation.lan", to: "synology@alerts.local", subject: "[DiskStation] Volume 1 on DiskStation has entered degraded mode",
      body: "Dear user,\n\nVolume 1 on DiskStation has entered degraded mode [1 drive(s) failed]. Please repair it as soon as possible.\n\nFrom DiskStation" },
  },
  {
    id: "uptime-kuma", name: "Uptime Kuma", service: "Uptime Kuma",
    description: "Monitor up/down alerts, with the monitor name, state and reason. Down is high priority.",
    confidence: "known",
    notes: "Uptime Kuma's SMTP notifications use the message \"[NAME] [🔴 Down] reason\" (or \"[✅ Up]\") as the subject unless you set a custom subject, and add a \"Time (zone): ...\" line to the body.",
    matchType: "subject", pattern: "\\[(🔴 Down|✅ Up)\\]",
    options: {
      extract: [
        { kind: "regex", field: "subject", pattern: "^\\[(?<monitor>[^\\]]+)\\]\\s*\\[(?:🔴 |✅ )?(?<state>Down|Up)\\]\\s*(?<reason>.*)$" },
        { kind: "regex", field: "body", pattern: "^Time \\([^)]*\\):\\s*(?<at>.+)$" },
      ],
      titleTemplate: "{{monitor}} is {{state}}", bodyTemplate: "{{reason|{{body}}}}\n{{at}}",
      priorityRules: [{ field: "var:state", pattern: "^down$", priority: 8 }, { field: "var:state", pattern: "^up$", priority: 3 }],
    },
    sample: { from: "kuma@monitor.lan", to: "kuma@alerts.local", subject: "[Home Assistant] [🔴 Down] connect ECONNREFUSED 192.168.0.20:8123",
      body: "[Home Assistant] [🔴 Down] connect ECONNREFUSED 192.168.0.20:8123\nTime (Europe/London): 2026-10-24 15:20:11" },
  },
  {
    id: "cron", name: "Cron job output", service: "cron",
    description: "Mail cron sends when a job prints output, with user, host and command pulled out.",
    confidence: "known",
    notes: "Vixie/cronie cron mails use the subject \"Cron <user@host> command\". Only jobs that print something send mail. Errors are flagged when the output says error/failed.",
    matchType: "subject", pattern: "^Cron <",
    options: {
      extract: [{ kind: "regex", field: "subject", pattern: "^Cron <(?<user>[^@>]+)@(?<host>[^>]+)>\\s*(?<command>.*)$" }],
      titleTemplate: "cron on {{host}}: {{command:80}}",
      priorityRules: [{ field: "body", pattern: "error|failed|fatal|traceback", priority: 7 }],
    },
    sample: { from: "root@server.lan", to: "cron@alerts.local", subject: "Cron <root@server> /usr/local/bin/backup.sh",
      body: "rsync: [sender] link_stat \"/mnt/data\" failed: No such file or directory (2)\nrsync error: some files/attrs were not transferred (code 23)" },
  },
];
