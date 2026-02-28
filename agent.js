// agent.js

function startAgent() {
  console.log("🤖 ACP Agent started");

  // 상태 확인용 (1분마다 살아있는지 로그)
  setInterval(() => {
    console.log("Agent alive:", new Date().toISOString());
  }, 60000);
}

module.exports = startAgent;
