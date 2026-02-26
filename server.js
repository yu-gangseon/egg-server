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
const SUCCESS_RATE = 1.0;
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

console.log("SERVER WALLET:", signer.address);

/*
Manifold Creator Core ABI
- mintBase(address[])
*/
const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  [
    "function mintBase(address[] calldata receivers) external",
    "function balanceOf(address owner) view returns (uint256)"
  ],
  signer
);

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
        output: "Unauthorized"
      });
    }

    /* 2. 지갑 확인 */
    const wallet = req.body.wallet?.toLowerCase();
    if (!wallet || !ethers.isAddress(wallet)) {
      return res.json({
        success: true,
        output: "❌ Invalid wallet"
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
        output: "🚫 Max 10 NFTs per wallet"
      });
    }

    /* 5. 확률 (10%) */
    if (Math.random() > SUCCESS_RATE) {
      console.log("FAIL:", wallet);
      return res.json({
        success: true,
        output: "❌ Egg failed"
      });
    }

    /* 6. NFT 민팅 (Manifold 방식) */
    console.log("MINT:", wallet);

    const tx = await contract.mintBase([wallet]);
    await tx.wait();

    return res.json({
      success: true,
      output: `🎉 Mystery Egg minted!\nTX: ${tx.hash}`,
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
