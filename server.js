const express = require("express");
const rateLimit = require("express-rate-limit");
const { ethers } = require("ethers");

const app = express();
app.use(express.json());

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
   기본 검증 (서버 시작 시)
======================== */
if (!ACP_SECRET || !RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error("환경변수 누락!");
  process.exit(1);
}

/* ========================
   IP Rate Limit
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
   메타데이터 CID
======================== */
const METADATA = {
  GOLD: "ipfs://bafkreiaglxxl3nrnc4qrsf5qqwwqca2yujl53uk5qgjwgpik6t6ncnxqkm",
  SILVER: "ipfs://bafkreidao4nmtbksyuviog2jpmzmtqoiumebnaejxvgh7mq44mavon2t4e",
  COMMON: "ipfs://bafkreiaucpmqeu6ztdhhm55gnbpdmjejjvmdnoorrl6mts4wzicfmnw4jm"
};

/* ========================
   쿨다운 저장 (메모리)
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
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    /* 2. 지갑 검사 */
    const wallet = req.body.wallet?.toLowerCase();
    if (!wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "invalid wallet"
      });
    }

    /* 3. 쿨다운 */
    const now = Date.now();
    const last = cooldown.get(wallet);
    if (last && now - last < COOLDOWN_TIME) {
      return res.json({
        success: false,
        message: "요청이 너무 빠릅니다."
      });
    }
    cooldown.set(wallet, now);

    /* 4. 전체 공급 제한 */
    const totalSupply = await contract.totalSupply();
    if (totalSupply >= BigInt(MAX_TOTAL_SUPPLY)) {
      return res.json({
        success: false,
        message: "에그가 모두 소진되었습니다."
      });
    }

    /* 5. 지갑당 보유 제한 */
    const balance = await contract.balanceOf(wallet);
    if (balance >= BigInt(MAX_PER_WALLET)) {
      return res.json({
        success: false,
        message: "계정당 최대 10개까지만 보유 가능합니다."
      });
    }

    /* 6. 성공 확률 (10%) */
    if (Math.random() > SUCCESS_RATE) {
      console.log("FAIL:", wallet);
      return res.json({
        success: false,
        message: "에그가 깨졌습니다."
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
      rarity,
      metadata,
      txHash: tx.hash
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message
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
