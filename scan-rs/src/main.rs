//! 뽑는 층만 Rust 로 옮긴다. 판정은 손대지 않는다.
//!
//! `src/scan.mjs` 의 `readSession` 이 파일 하나에서 사실을 내는 전부라, 그 계약만 맞추면
//! 축·스냅샷·지시서는 그대로 돈다. 그래서 여기 있는 규칙은 전부 JS 를 그대로 옮긴 것이고,
//! 다르게 하고 싶은 것이 있어도 안 한다. **먼저 물을 것은 빠르기가 아니라 같은 답인가다.**
//!
//! `tools/facts.mjs --only session` 과 같은 NDJSON 을 낸다. `tools/compare.mjs` 로 견준다.

use rayon::prelude::*;
use serde_json::{Map, Value};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

struct Found {
    file: PathBuf,
    session_id: Option<String>,
    is_sub: bool,
}

// JS 의 truthy 다. null·false·0·"" 가 거짓이다. `if (d.cwd)` 같은 자리에 쓴다.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}

// JS 의 String(v) 다. 문자열은 그대로, 나머지는 JSON 표기로 간다.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

// `.slice(0, 120)` 은 UTF-16 단위다. 바이트로 자르면 한글 stderr 에서 갈린다.
fn utf16_take(s: &str, n: usize) -> String {
    let mut out = String::new();
    let mut used = 0;
    for ch in s.chars() {
        let w = ch.len_utf16();
        if used + w > n {
            break;
        }
        out.push(ch);
        used += w;
    }
    out
}

// Node 의 `fs.statSync(f).mtime.toISOString()` 과 같아야 한다.
//
// **버리는 게 아니라 반올림이다.** 실측(2026-08-28): nanos 가 1786040353544873675 인 파일에서
// `new Date(mtimeMs)` 는 `.544Z` 를 내는데 `statSync().mtime` 은 `.545Z` 를 낸다.
// Node 가 Stats 의 Date 를 만들 때 밀리초를 반올림한다. 버리는 쪽으로 짰더니
// 전사 1,253개 중 606개가 1밀리초씩 어긋났다. 대조가 이걸 잡았다.
fn mtime_iso(path: &Path) -> Value {
    let Ok(meta) = fs::metadata(path) else { return Value::Null };
    let Ok(t) = meta.modified() else { return Value::Null };
    let Ok(d) = t.duration_since(UNIX_EPOCH) else { return Value::Null };
    let ms = ((d.as_nanos() + 500_000) / 1_000_000) as i64;
    let (days, msod) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let (y, m, dd) = civil_from_days(days);
    Value::String(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        dd,
        msod / 3_600_000,
        msod / 60_000 % 60,
        msod / 1000 % 60,
        msod % 1000
    ))
}

// Howard Hinnant 의 civil_from_days. 달력 라이브러리를 안 붙이려고 그대로 옮겼다.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// JS 의 hookFailReason. 무엇이 왜 실패했는지 없으면 여러 줄이 서로 다른 문제처럼 보인다.
fn hook_fail_reason(hook: &Map<String, Value>) -> Option<String> {
    if truthy(hook.get("timedOut")) {
        let sec = |k: &str| -> String {
            match hook.get(k) {
                Some(v) if truthy(Some(v)) => {
                    let x = v.as_f64().unwrap_or(0.0) / 1000.0;
                    // JS 의 toFixed 는 반올림이 0 에서 먼 쪽이다. Rust 의 {:.1} 은 짝수 쪽이라
                    // 먼저 반올림해서 맞춘다.
                    format!("{:.1}초", (x * 10.0).round() / 10.0)
                }
                _ => "?".to_string(),
            }
        };
        return Some(format!(
            "{} 제한을 넘겨 잘림 ({} 걸렸다)",
            sec("timeoutMs"),
            sec("durationMs")
        ));
    }
    let raw = hook.get("stderr").map(js_string).unwrap_or_default();
    let line = raw.trim().split('\n').filter(|x| !x.is_empty()).next_back()?;
    Some(utf16_take(line, 120))
}

fn bump(m: &mut Map<String, Value>, key: &str) {
    let n = m.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
    m.insert(key.to_string(), Value::from(n + 1));
}

fn read_session(path: &Path) -> Value {
    let mut repo = Value::Null;
    let mut repos: Vec<Value> = Vec::new();
    let mut started: Option<String> = None;
    let mut ended: Option<String> = None;
    let mut hooks = Map::new();
    let mut denials = Map::new();
    let mut turns: u64 = 0;
    let mut lines: u64 = 0;
    let mtime = mtime_iso(path);

    // Node 의 readFileSync(file, 'utf8') 는 깨진 바이트를 U+FFFD 로 바꾼다. 안 던진다.
    let bytes = fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes);

    for line in text.split('\n') {
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        let Some(d) = d.as_object() else { continue };
        lines += 1;

        if let Some(ts) = d.get("timestamp").and_then(|v| v.as_str()) {
            if !ts.is_empty() {
                if started.as_deref().is_none_or(|s| ts < s) {
                    started = Some(ts.to_string());
                }
                if ended.as_deref().is_none_or(|s| ts > s) {
                    ended = Some(ts.to_string());
                }
            }
        }

        // 함정 7. cwd 가 줄마다 있다. repo 는 마지막 것, 거쳐온 곳은 repos 에 다 남긴다.
        if truthy(d.get("cwd")) {
            let cwd = js_string(d.get("cwd").unwrap());
            let as_val = Value::String(cwd);
            if !repos.contains(&as_val) {
                repos.push(as_val.clone());
            }
            repo = as_val;
        }

        if truthy(d.get("toolDenialKind")) {
            bump(&mut denials, &js_string(d.get("toolDenialKind").unwrap()));
        }
        if d.get("type").and_then(|v| v.as_str()) == Some("system")
            && d.get("subtype").and_then(|v| v.as_str()) == Some("turn_duration")
        {
            turns += 1;
        }

        let Some(hook) = d.get("attachment").and_then(|v| v.as_object()) else { continue };
        if !truthy(hook.get("hookEvent")) {
            continue;
        }
        // `??` 는 null·undefined 일 때만 넘어간다. 빈 문자열은 그대로 키가 된다.
        let key = match hook.get("hookName") {
            Some(v) if !v.is_null() => js_string(v),
            _ => js_string(hook.get("hookEvent").unwrap()),
        };
        let kind = hook.get("type").filter(|v| !v.is_null()).map(js_string).unwrap_or_else(|| "unknown".into());

        let entry = hooks.entry(key).or_insert_with(|| {
            let mut m = Map::new();
            m.insert("ok".into(), Value::from(0u64));
            m.insert("fail".into(), Value::from(0u64));
            m.insert("kinds".into(), Value::Object(Map::new()));
            Value::Object(m)
        });
        let entry = entry.as_object_mut().unwrap();
        bump(entry.get_mut("kinds").unwrap().as_object_mut().unwrap(), &kind);

        // 함정 6·11. 실패로 볼 것은 error·cancelled·blocked·denied 뿐이다.
        let lowered = kind.to_lowercase();
        let failed = ["error", "cancelled", "blocked", "denied"].iter().any(|w| lowered.contains(w));
        if failed {
            let n = entry.get("fail").and_then(|v| v.as_u64()).unwrap_or(0);
            entry.insert("fail".into(), Value::from(n + 1));
            if let Some(why) = hook_fail_reason(hook) {
                let list = entry.entry("why".to_string()).or_insert_with(|| Value::Array(vec![]));
                let list = list.as_array_mut().unwrap();
                let w = Value::String(why);
                if !list.contains(&w) {
                    list.push(w);
                }
            }
        } else {
            let n = entry.get("ok").and_then(|v| v.as_u64()).unwrap_or(0);
            entry.insert("ok".into(), Value::from(n + 1));
        }
    }

    let mut out = Map::new();
    out.insert("repo".into(), repo);
    out.insert("repos".into(), Value::Array(repos));
    out.insert("startedAt".into(), started.map(Value::String).unwrap_or(Value::Null));
    out.insert("endedAt".into(), ended.map(Value::String).unwrap_or(Value::Null));
    out.insert("mtime".into(), mtime);
    out.insert("hooks".into(), Value::Object(hooks));
    out.insert("denials".into(), Value::Object(denials));
    out.insert("turns".into(), Value::from(turns));
    out.insert("lines".into(), Value::from(lines));
    Value::Object(out)
}

// `/<tool-use-id>(toolu_[A-Za-z0-9]+)<\/tool-use-id>[\s\S]*?<status>([a-z]+)<\/status>/` 를
// 손으로 옮겼다. 크레이트를 하나 안 늘리려고 그랬고, 규칙이 단순해서 그럴 수 있다.
//
// 왼쪽부터 처음 맞는 자리를 잡고, 그 뒤로 처음 나오는 쓸 만한 `<status>` 를 쓴다.
// 게으른 수량자가 하는 일과 같다. `<status>ABC</status>` 처럼 소문자가 아닌 것은
// 건너뛰고 다음 `<status>` 를 본다.
fn status_match(line: &str) -> Option<(String, String)> {
    const OPEN: &str = "<tool-use-id>";
    const CLOSE: &str = "</tool-use-id>";
    let b = line.as_bytes();
    let mut from = 0;
    while let Some(rel) = line[from..].find(OPEN) {
        let idg = from + rel + OPEN.len();
        from = from + rel + 1;
        if !line[idg..].starts_with("toolu_") {
            continue;
        }
        let mut end = idg + "toolu_".len();
        while end < b.len() && b[end].is_ascii_alphanumeric() {
            end += 1;
        }
        if end == idg + "toolu_".len() || !line[end..].starts_with(CLOSE) {
            continue;
        }
        let id = line[idg..end].to_string();
        // 여기부터 뒤로 가며 쓸 만한 상태를 찾는다.
        let mut at = end + CLOSE.len();
        while let Some(r) = line[at..].find("<status>") {
            let sg = at + r + "<status>".len();
            at = at + r + 1;
            let mut se = sg;
            while se < b.len() && b[se].is_ascii_lowercase() {
                se += 1;
            }
            if se > sg && line[se..].starts_with("</status>") {
                return Some((id, line[sg..se].to_string()));
            }
        }
    }
    None
}

// `src/scan.mjs` 의 extractFile 이다. 위임·끝난 상태·토큰을 한 번 훑어 같이 낸다.
fn extract_file(path: &Path) -> Value {
    let mut dispatch: Vec<Value> = Vec::new();
    let mut status: Vec<Value> = Vec::new();
    let (mut tin, mut tout, mut cread, mut ccreate) = (0i64, 0i64, 0i64, 0i64);

    let bytes = fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes);

    for line in text.split('\n') {
        // 끝난 상태는 queue-operation 줄에만 있다.
        if line.contains("queue-operation") && line.contains("<status>") {
            if let Some((id, st)) = status_match(line) {
                // 문서 속 `completed|failed|killed|stopped` 같은 문자열이 섞여 들어온다
                if ["completed", "failed", "killed", "stopped"].contains(&st.as_str()) {
                    status.push(Value::Array(vec![Value::String(id), Value::String(st)]));
                }
            }
        }
        // JSON 파싱은 비싸다. 문자열로 먼저 거른다.
        if !line.contains("\"tool_use\"") && !line.contains("\"usage\"") {
            continue;
        }
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        let Some(d) = d.as_object() else { continue };
        if d.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let msg = d.get("message").and_then(|v| v.as_object());
        let mid = msg
            .and_then(|m| m.get("id"))
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(Value::Null);
        // content 가 배열이 아니면 JS 도 아무것도 안 담는다(문자열이면 글자를 돌 뿐이다).
        if let Some(list) = msg.and_then(|m| m.get("content")).and_then(|v| v.as_array()) {
            for c in list {
                let Some(c) = c.as_object() else { continue };
                if c.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                    continue;
                }
                let name = c.get("name").and_then(|v| v.as_str());
                if name != Some("Agent") && name != Some("Task") {
                    continue;
                }
                let id = c.get("id").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null);
                dispatch.push(Value::Array(vec![id, mid.clone()]));
            }
        }
        if let Some(u) = msg.and_then(|m| m.get("usage")).filter(|v| truthy(Some(v))).and_then(|v| v.as_object()) {
            let n = |k: &str| u.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
            tin += n("input_tokens");
            tout += n("output_tokens");
            cread += n("cache_read_input_tokens");
            ccreate += n("cache_creation_input_tokens");
        }
    }

    let mut tokens = Map::new();
    tokens.insert("in".into(), Value::from(tin));
    tokens.insert("out".into(), Value::from(tout));
    tokens.insert("cacheRead".into(), Value::from(cread));
    tokens.insert("cacheCreate".into(), Value::from(ccreate));

    let mut out = Map::new();
    out.insert("dispatch".into(), Value::Array(dispatch));
    out.insert("status".into(), Value::Array(status));
    out.insert("tokens".into(), Value::Object(tokens));
    Value::Object(out)
}

// `src/scan.mjs` 의 startedAt. 전사 첫 줄의 timestamp 만 본다.
// **앞 64KB 만 읽는다.** 위임 하나마다 전사를 통째로 읽으면 파일 1,070개가 아니라 GB 가 된다.
fn started_at(jsonl: &Path) -> Option<String> {
    use std::io::Read;
    let mut fd = fs::File::open(jsonl).ok()?;
    let mut buf = vec![0u8; 65536];
    let n = fd.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let line = text.split('\n').next()?;
    let v: Value = serde_json::from_str(line).ok()?;
    match v.get("timestamp") {
        Some(t) if !t.is_null() => Some(js_string(t)),
        _ => None,
    }
}

// `src/scan.mjs` 의 readDelegation. meta.json 하나에서 위임 한 건을 편다.
// 읽히지 않으면 null 이다. 부르는 쪽이 그걸 보고 건너뛴다.
fn read_delegation(meta_path: &Path) -> Value {
    let Ok(bytes) = fs::read(meta_path) else { return Value::Null };
    let Ok(meta) = serde_json::from_slice::<Value>(&String::from_utf8_lossy(&bytes).into_owned().into_bytes())
    else {
        return Value::Null;
    };
    let Some(meta) = meta.as_object() else { return Value::Null };

    // `?? null` 은 null·undefined 일 때만 넘어간다. false 나 0 이나 "" 는 그대로 둔다.
    let keep = |k: &str| meta.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null);

    // 짝이 되는 전사는 같은 디렉터리에 <agentId>.jsonl 로 있다.
    let stem = meta_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.trim_end_matches(".meta.json").to_string())
        .unwrap_or_default();
    let jsonl = meta_path.with_file_name(format!("{stem}.jsonl"));
    let ts = started_at(&jsonl)
        .map(Value::String)
        .unwrap_or_else(|| mtime_iso(meta_path));

    let mut out = Map::new();
    out.insert("agentType".into(), keep("agentType"));
    out.insert("model".into(), keep("model"));
    out.insert("spawnDepth".into(), keep("spawnDepth"));
    out.insert("parentAgentId".into(), keep("parentAgentId"));
    // Boolean(meta.isFork) 다. `?? null` 이 아니라 참거짓으로 접는다.
    out.insert("isFork".into(), Value::Bool(truthy(meta.get("isFork"))));
    out.insert("toolUseId".into(), keep("toolUseId"));
    out.insert("description".into(), keep("description"));
    out.insert("ts".into(), ts);
    Value::Object(out)
}

fn looks_like_session(name: &str) -> bool {
    name.len() == 36 && name.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase() || c == '-')
}

fn walk(dir: &Path, session_id: Option<&str>, is_sub: bool, out: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        // Dirent.isDirectory() 는 심링크를 안 따라간다. file_type() 도 같다.
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let next = if looks_like_session(&name) { Some(name.as_str()) } else { session_id };
            walk(&p, next, is_sub || name == "subagents", out);
        } else if name.ends_with(".jsonl") && p.exists() {
            // 깨진 심링크가 있다. exists 로 걸러야 아래에서 안 터진다.
            out.push(Found {
                session_id: if is_sub {
                    session_id.map(|s| s.to_string())
                } else {
                    Some(name[..name.len() - 6].to_string())
                },
                file: p,
                is_sub,
            });
        }
    }
}

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let i = args.iter().position(|a| a == &format!("--{name}"))?;
    match args.get(i + 1) {
        Some(v) if !v.starts_with("--") => Some(v.clone()),
        _ => {
            eprintln!("--{name} 에 값이 없다");
            std::process::exit(1);
        }
    }
}

// 캐시에 없는 것만 받는다.
//
// 늘 전부 훑으면 캐시가 있을 때 오히려 느려진다. 실측: 캐시가 맞으면 JS 쪽이 18ms 인데
// 여기는 1,254개를 다 읽어 430ms 다. 부르는 쪽이 낡은 것만 골라 넘기면 그 차이가 없다.
//
// 이 모드에서는 준 경로를 그대로 되돌려준다. 부르는 쪽이 그 문자열로 캐시를 찾는다.
fn read_list() -> Vec<PathBuf> {
    use std::io::Read;
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).ok();
    buf.lines().filter(|l| !l.is_empty()).map(PathBuf::from).collect()
}

fn main() {
    let root = arg("root").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        Path::new(&home).join(".claude").join("projects")
    });
    let root = fs::canonicalize(&root).unwrap_or(root);

    // 무엇을 낼지. tools/facts.mjs 의 --only 와 같다.
    let only = arg("only");
    match only.as_deref() {
        None | Some("session") | Some("transcript") | Some("delegation") => {}
        Some(v) => {
            eprintln!("--only 는 session·transcript·delegation 중 하나여야 한다: {v}");
            std::process::exit(1);
        }
    }
    // delegation 은 읽는 파일이 다르다(.meta.json). 훑기가 아니라 목록으로만 받는다.
    let want_delegation = only.as_deref() == Some("delegation");
    let want_session = !want_delegation && only.as_deref() != Some("transcript");
    let want_transcript = !want_delegation && only.as_deref() != Some("session");

    // `--files -` 면 훑지 않고 받은 목록만 읽는다. 경로는 준 그대로 되돌린다.
    if arg("files").as_deref() == Some("-") {
        let given = read_list();
        let lines: Vec<String> = given
            .par_iter()
            .map(|p| {
                let mut row = Map::new();
                row.insert("file".into(), Value::String(p.to_string_lossy().into_owned()));
                if want_delegation {
                    row.insert("delegation".into(), read_delegation(p));
                }
                if want_session {
                    row.insert("session".into(), read_session(p));
                }
                if want_transcript {
                    row.insert("transcript".into(), extract_file(p));
                }
                serde_json::to_string(&Value::Object(row)).unwrap()
            })
            .collect();
        let stdout = std::io::stdout();
        let mut w = BufWriter::new(stdout.lock());
        for l in &lines {
            writeln!(w, "{l}").unwrap();
        }
        w.flush().unwrap();
        return;
    }

    if want_delegation {
        eprintln!("--only delegation 은 `--files -` 로 목록을 받아야 한다");
        std::process::exit(1);
    }

    let mut files = Vec::new();
    walk(&root, None, false, &mut files);

    let lines: Vec<String> = files
        .par_iter()
        .map(|f| {
            let mut row = Map::new();
            // 뿌리 기준 상대경로. 절대경로를 넣으면 남의 기계와 대조할 수 없다.
            let rel = f.file.strip_prefix(&root).unwrap_or(&f.file).to_string_lossy().into_owned();
            // 키 순서까지 JS 와 같아야 한다. **정렬하면 안 된다.**
            //
            // 처음엔 양쪽을 정렬해서 견줬다. 그랬더니 훅이 처음 나온 순서가 지워졌고,
            // 리포트의 훅 사례 순서가 JS 와 달라졌다. 대조는 "같다"고 했는데 화면이 달랐다.
            // 넣은 순서가 뜻을 가진다. serde_json 의 preserve_order 로 그 순서를 지킨다.
            row.insert("file".into(), Value::String(rel));
            row.insert(
                "sessionId".into(),
                f.session_id.clone().map(Value::String).unwrap_or(Value::Null),
            );
            row.insert("isSub".into(), Value::Bool(f.is_sub));
            if want_session {
                row.insert("session".into(), read_session(&f.file));
            }
            if want_transcript {
                row.insert("transcript".into(), extract_file(&f.file));
            }
            serde_json::to_string(&Value::Object(row)).unwrap()
        })
        .collect();

    let stdout = std::io::stdout();
    let mut w = BufWriter::new(stdout.lock());
    for l in &lines {
        writeln!(w, "{l}").unwrap();
    }
    w.flush().unwrap();
    eprintln!("전사 {}개", lines.len());
}
