import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { config as envConfig } from "dotenv";

const ADDRESS_TABLE_PATH = path.resolve(__dirname, "..", "contract-addresses.csv");
envConfig({ path: path.resolve(__dirname, "./.env") });

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const network: string = hre.hardhatArguments.network ? hre.hardhatArguments.network : "ropsten";
  const deployedContracts = await loadDeployedAddress();
  const proxyAddress = deployedContracts[network];

  const verify: boolean = process.env.FT_VERIFY == "true";
  const upgrade: boolean = process.env.FT_UPGRADE == "true";

  if (!upgrade) {
    /**
     * Deploy, we normally do this only once
     * You may suffer such error: Contract `xxxxx` is not upgrade safe since
     * SafeERC20 and SafeERC721 are using address.sol which has some functions using delegatecall.
     * FIXME: add { unsafeAllow: ['delegatecall'] } as param for deployProxy()
     * TODO: For long-term consideration, we could replace safeERC20 with SafeERC20Upgradeable (same for ERC721)
     * see detail at: https://forum.openzeppelin.com/t/error-contract-is-not-upgrade-safe-use-of-delegatecall-is-not-allowed/16859
     */
    const HappyRedPacketImpl = await ethers.getContractFactory("HappyRedPacket");
    const HappyRedPacketProxy = await upgrades.deployProxy(HappyRedPacketImpl, [], {
      unsafeAllow: ["delegatecall"],
    });
    await HappyRedPacketProxy.deployed();
    console.log("HappyRedPacketProxy: " + HappyRedPacketProxy.address);
    const admin = await upgrades.admin.getInstance();
    const impl_addr = await admin.getProxyImplementation(HappyRedPacketProxy.address);
    if (!verify) return;
    await hre.run("verify:verify", {
      address: impl_addr,
      constructorArguments: [],
    });
  } else {
    // upgrade contract
    const HappyRedPacketImpl = await ethers.getContractFactory("HappyRedPacket");
    const instance = await upgrades.upgradeProxy(proxyAddress, HappyRedPacketImpl);

    await instance.deployTransaction.wait();
    const admin = await upgrades.admin.getInstance();
    const impl = await admin.getProxyImplementation(proxyAddress);
    // example: `npx hardhat verify --network rinkeby 0x8974Ce3955eE1306bA89687C558B6fC1E5be777B`;
    if (!verify) return;
    await hre.run("verify:verify", {
      address: impl,
      constructorArguments: [],
    });
  }
};

async function loadDeployedAddress(): Promise<Record<string, string>> {
  const data = await fs.readFile(ADDRESS_TABLE_PATH, "utf-8");
  const columns = ["Chain", "HappyRedPacket", "HappyRedPacket_ERC721"];
  const records = parse(data, { delimiter: ",", columns, from: 2 });
  let deployedContract: Record<string, string> = {};
  for (const { Chain, HappyRedPacket } of records) {
    deployedContract[Chain.toLowerCase()] = HappyRedPacket;
  }
  return deployedContract;
}

func.tags = ["HappyRedPacket"];

module.exports = func;
