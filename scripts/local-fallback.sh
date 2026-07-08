#!/bin/bash
# 本地兜底更新：GitHub Actions 定时任务不可靠（新仓库经常被跳过），
# 这个脚本由 launchd 每天在几个时间点运行，发现线上数据不是今天的就本地抓一份推上去。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Hong_Kong date '+%-m月%-d日')
ONLINE_DATE=$(curl -s --max-time 30 "https://grace4201.github.io/hk-us-market-brief/data/latest.json?t=$(date +%s)" | grep -o '"reportDate": "[^"]*"' | cut -d'"' -f4 || echo "")

if [ "$ONLINE_DATE" = "$TODAY" ]; then
  echo "$(date '+%F %T') 线上已是今日数据（$ONLINE_DATE），无需兜底"
  exit 0
fi

echo "$(date '+%F %T') 线上数据是「$ONLINE_DATE」，不是今天（$TODAY），开始本地兜底更新"
git pull --rebase --quiet
node scripts/update-market-brief.mjs

if git diff --quiet data/; then
  echo "数据无变化，跳过提交"
  exit 0
fi

git add data/
git commit --quiet -m "本地兜底更新行情数据 $(TZ=Asia/Hong_Kong date '+%Y-%m-%d %H:%M')"
git push --quiet
echo "$(date '+%F %T') 兜底更新完成并已推送"
