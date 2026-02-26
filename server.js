const express = require("express");
const rateLimit = require("express-rate-limit");
const { ethers } = require("ethers");

const app = express();
app.use(express.json());

app.set("trust proxy", 1);
/* ========================
   경제 설정
======================== */
const MAX_PER_WALLET = 10;
const MAX_TOTAL_SUPPLY = 100000;
const SUCCESS_RATE = 0.10;
const COOLDOWN_TIME = 30000;

/* ========================
   환경변수
======================== */
const ACP_SECRET = process.env.ACP_SECRET;
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

/* ========================
   기본 검증
======================== */
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

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  [
    "function mint(address to, string uri)",
    "function balanceOf(address owner) view returns (uint256)",
    "function totalSupply() view returns (uint256)"
  ],
  signer
);

/* ========================
   메타데이터
======================== */
const METADATA = {
  GOLD: "ipfs://bafkreiaglxxl3nrnc4qrsf5qqwwqca2yujl53uk5qgjwgpik6t6ncnxqkm",
  SILVER: "ipfs://bafkreidao4nmtbksyuviog2jpmzmtqoiumebnaejxvgh7mq44mavon2t4e",
  COMMON: "ipfs://bafkreiaucpmqeu6ztdhhm55gnbpdmjejjvmdnoorrl6mts4wzicfmnw4jm"
};

/* ========================
   쿨다운 저장
======================== */
const cooldown = new Map();

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
        output: "Unauthorized request"
      });
    }

    /* 2. 지갑 확인 */
    const wallet = req.body.wallet?.toLowerCase();
    if (!wallet || !ethers.isAddress(wallet)) {
      return res.json({
        success: true,
        output: "❌ 유효하지 않은 지갑 주소입니다."
      });
    }

    /* 3. 쿨다운 */
    const now = Date.now();
    const last = cooldown.get(wallet);
    if (last && now - last < COOLDOWN_TIME) {
      return res.json({
        success: true,
        output: "⏳ 잠시 후 다시 시도해주세요."
      });
    }
    cooldown.set(wallet, now);

    /* 4. 전체 공급 제한 */
    const totalSupply = await contract.totalSupply();
    if (totalSupply >= BigInt(MAX_TOTAL_SUPPLY)) {
      return res.json({
        success: true,
        output: "🚫 모든 Mystery Egg가 소진되었습니다."
      });
    }

    /* 5. 지갑당 보유 제한 */
    const balance = await contract.balanceOf(wallet);
    if (balance >= BigInt(MAX_PER_WALLET)) {
      return res.json({
        success: true,
        output: "🚫 한 계정당 최대 10개의 에그만 보유할 수 있습니다."
      });
    }

    /* 6. 성공 확률 */
    if (Math.random() > SUCCESS_RATE) {
      console.log("FAIL:", wallet);
      return res.json({
        success: true,
        output: "❌ 에그가 깨졌습니다. 아무것도 얻지 못했습니다."
      });
    }

    /* 7. 등급 결정 */
    const roll = Math.random();
    let rarity;
    let metadata;

    if (roll < 0.01) {
      rarity = "Gold";
      metadata = METADATA.GOLD;
    } else if (roll < 0.11) {
      rarity = "Silver";
      metadata = METADATA.SILVER;
    } else {
      rarity = "Common";
      metadata = METADATA.COMMON;
    }

    /* 8. NFT 민팅 */
    console.log("MINT:", wallet, rarity);

    const tx = await contract.mint(wallet, metadata);
    await tx.wait();

    return res.json({
      success: true,
      output: `🎉 ${rarity} Mystery Egg를 획득했습니다!\nTX: ${tx.hash}`,
      rarity,
      metadata,
      txHash: tx.hash
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.json({
      success: true,
      output: "⚠️ 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Egg server running on port", PORT);
});
