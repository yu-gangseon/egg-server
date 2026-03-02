const express = require("express");
const rateLimit = require("express-rate-limit");
const { ethers } = require("ethers");
const axios = require("axios");

const app = express();
app.use(express.json());
app.set("trust proxy", 1);

/* ========================
   경제 설정
======================== */
const MAX_PER_WALLET = 100;
const SUCCESS_RATE = 0.2;
const COOLDOWN_TIME = 10000;

/* ========================
   환경변수
======================== */
const ACP_SECRET = process.env.ACP_SECRET;
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

if (!ACP_SECRET || !RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error("환경변수 누락!");
  process.exit(1);
}

/* ========================
   Rate Limit
======================== */
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30
}));

/* ========================
   블록체인 연결
======================== */
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

console.log("SERVER WALLET:", signer.address);

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  [
    "function mint(address to, string uri) external",
    "function balanceOf(address owner) view returns (uint256)"
  ],
  signer
);

/* ========================
   IPFS 메타데이터
======================== */
const METADATA_URI = {
  GOLD:   "ipfs://bafkreigotib5iwm4fjj4p4nimnmxml3az7ig3m64o6bktu5ft7nm2f552u",
  SILVER: "ipfs://bafkreigokenfqdaailgjjxhtbnxvozyqhwj26iqf2or5et2hde55ncgyxi",
  COMMON: "ipfs://bafkreid75y3v6w2salzrwnjiuf7e3inyhxhz5jyuv62efvx5ndrljlsoeu"
};

/* ========================
   쿨다운
======================== */
const cooldown = new Map();

/* ========================
   Agent Revenue Cache (30초)
======================== */
const revenueCache = new Map();
const CACHE_TIME = 30000;

/* ========================
   메인 API
======================== */
app.post("/egg", async (req, res) => {
  try {
    /* 1. ACP 인증 */
    const apiKey = req.headers["x-acp-key"];
    if (apiKey !== ACP_SECRET) {
      return res.json({
        success: true,
        output: "Unauthorized"
      });
    }

    /* 🔥 ACP 요청 전체 확인 */
    console.log("ACP BODY:", req.body);

    /* 🔥 wallet 위치 전체 대응 (핵심 수정) */
    const wallet = (
      req.body.wallet ||
      req.body.buyerWallet ||
      req.body.input?.wallet
    )?.toLowerCase();

    console.log("PARSED WALLET:", wallet);

    if (!wallet || !ethers.isAddress(wallet)) {
      return res.json({
        success: true,
        output: "❌ Invalid wallet (ACP request empty)"
      });
    }

    /* 3. 쿨다운 */
    const now = Date.now();
    const last = cooldown.get(wallet);
    if (last && now - last < COOLDOWN_TIME) {
      return res.json({
        success: true,
        output: "⏳ Please wait before retry"
      });
    }
    cooldown.set(wallet, now);

    /* 4. 지갑당 제한 */
    const balance = await contract.balanceOf(wallet);
    if (balance >= BigInt(MAX_PER_WALLET)) {
      return res.json({
        success: true,
        output: "🚫 Max NFTs per wallet reached"
      });
    }

    /* 5. 성공 확률 */
    if (Math.random() > SUCCESS_RATE) {
      console.log("EGG FAIL:", wallet);
      return res.json({
        success: true,
        output: "❌ Egg failed"
      });
    }

    /* 6. 등급 결정 */
    const roll = Math.random();
    let rarity;
    let metadataURI;

    if (roll < 0.10) {
      rarity = "GOLD";
      metadataURI = METADATA_URI.GOLD;
    } else if (roll < 0.30) {
      rarity = "SILVER";
      metadataURI = METADATA_URI.SILVER;
    } else {
      rarity = "COMMON";
      metadataURI = METADATA_URI.COMMON;
    }

    console.log("MINT TO:", wallet, rarity);

    /* 7. 민팅 */
    const tx = await contract.mint(wallet, metadataURI);
    await tx.wait();

    return res.json({
      success: true,
      output: `🎉 ${rarity} Mystery Egg minted!\nTX: ${tx.hash}`,
      rarity,
      txHash: tx.hash
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.json({
      success: true,
      output: "⚠️ Server error"
    });
  }
});

/* ========================
   Offer : Agent Revenue (FINAL COMPLETE)
======================== */
app.post("/agent-revenue", async (req, res) => {
  try {
    const apiKey = req.headers["x-acp-key"];
    if (apiKey !== ACP_SECRET) {
      return res.json({ success: true, output: "Unauthorized" });
    }

    const input = (req.body.agentName || req.body.input || "").trim();
    if (!input) {
      return res.json({ success: true, output: "Enter agent name or ID" });
    }

    const normalize = (str) =>
      (str || "").toLowerCase().replace(/\s+/g, "");

    const target = normalize(input);

    /* ===== 캐시 확인 ===== */
    const cached = revenueCache.get(target);
    if (cached && Date.now() - cached.time < CACHE_TIME) {
      return res.json({
        success: true,
        output: cached.output
      });
    }

    let agent = null;
    let metrics = null;

    /* =======================================================
       1️⃣ 숫자 입력 → ID 직접 조회
    ======================================================= */
    if (/^\d+$/.test(input)) {
      try {
        const url = `https://acpx.virtuals.io/api/agents/${input}/details`;
        const response = await axios.get(url, { timeout: 5000 });

        const data = response.data.data || response.data;

        if (!data) {
          return res.json({
            success: true,
            output: `Agent ID ${input} not found`
          });
        }

        agent = data;
        metrics = data.metrics || {};
      } catch (e) {
        return res.json({
          success: true,
          output: `Agent ID ${input} not found`
        });
      }
    }

    /* =======================================================
       2️⃣ 이름 검색
    ======================================================= */
    if (!agent) {
      const searchUrl =
        `https://acpx.virtuals.io/api/agents` +
        `?filters[hasGraduated]=all` +
        `&sort=successfulJobCount` +
        `&search=${encodeURIComponent(input)}` +
        `&pagination[page]=1` +
        `&pagination[pageSize]=50`;

      const response = await axios.get(searchUrl, { timeout: 5000 });
      const agents = response.data.data || [];

      if (agents.length === 0) {
        return res.json({
          success: true,
          output: `Agent "${input}" not found`
        });
      }

      /* 정확 일치 */
      const exact = agents.filter(a =>
        normalize(a.name) === target
      );

      if (exact.length === 1) agent = exact[0];

      if (!agent && exact.length > 1) {
        return res.json({
          success: true,
          output:
            `Multiple agents found:\n` +
            exact.map(a => `- ${a.name} (ID: ${a.id})`).join("\n") +
            `\n\nPlease enter full name or ID.`
        });
      }

      /* startsWith */
      if (!agent) {
        const starts = agents.filter(a =>
          normalize(a.name).startsWith(target)
        );

        if (starts.length === 1) agent = starts[0];

        if (starts.length > 1) {
          return res.json({
            success: true,
            output:
              `Multiple agents found:\n` +
              starts.map(a => `- ${a.name} (ID: ${a.id})`).join("\n") +
              `\n\nPlease enter full name or ID.`
          });
        }
      }

      /* includes */
      if (!agent) {
        const includes = agents.filter(a =>
          normalize(a.name).includes(target)
        );

        if (includes.length === 1) agent = includes[0];

        if (includes.length > 1) {
          return res.json({
            success: true,
            output:
              `Multiple agents found:\n` +
              includes.map(a => `- ${a.name} (ID: ${a.id})`).join("\n") +
              `\n\nPlease enter full name or ID.`
          });
        }
      }

      if (!agent) {
        return res.json({
          success: true,
          output: `Agent "${input}" not found`
        });
      }

      metrics = agent.metrics || {};
    }

    /* =======================================================
       3️⃣ 결과
    ======================================================= */
    const result = `Agent: ${agent.name}
ID: ${agent.id}
Revenue: $${Number(metrics.revenue || 0).toFixed(2)}
Jobs: ${metrics.successfulJobCount || 0}
Buyers: ${metrics.uniqueBuyerCount || 0}
Success Rate: ${metrics.successRate || 0}%`;

    /* 캐시 저장 */
    revenueCache.set(target, {
      time: Date.now(),
      output: result
    });

    return res.json({
      success: true,
      output: result
    });

  } catch (err) {
    console.error("AGENT REVENUE ERROR:", err.message);
    return res.json({
      success: true,
      output: "Error fetching agent data"
    });
  }
});


/* ========================
   헬스 체크
======================== */
app.get("/", (req, res) => {
  res.send("Egg server running");
});

/* ========================
   서버 실행
======================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Egg server running on port", PORT);
});
