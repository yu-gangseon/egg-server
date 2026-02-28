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
const SUCCESS_RATE = 0.2; //
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
Remix NFT ABI
mint(address to, string uri)
*/
const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  [
    "function mint(address to, string uri) external",
    "function balanceOf(address owner) view returns (uint256)"
  ],
  signer
);

/* ========================
   IPFS 메타데이터 (등급별)
======================== */
const METADATA_URI = {
  GOLD:   "ipfs://bafkreigotib5iwm4fjj4p4nimnmxml3az7ig3m64o6bktu5ft7nm2f552u",
  SILVER: "ipfs://bafkreigokenfqdaailgjjxhtbnxvozyqhwj26iqf2or5et2hde55ncgyxi",
  COMMON: "ipfs://bafkreid75y3v6w2salzrwnjiuf7e3inyhxhz5jyuv62efvx5ndrljlsoeu"
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

    /* 5. 성공 확률 (20%) */
    if (Math.random() > SUCCESS_RATE) {
      console.log("FAIL:", wallet);
      return res.json({
        success: true,
        output: "❌ Egg failed"
      });
    }

    /* 6. 등급 확률 */
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

    console.log("MINT:", wallet, rarity);
    console.log("URI:", metadataURI);

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
