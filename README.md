# Owlracle Contracts

Contracts for Owlracle.


# Run containers

```
docker-compose up -d
```

* The *hardhat* container will be used to run the tests and deploy the contracts. Anything related to hardhat should be run from within this container.
* The *slither* container will be used to scan for vulnerabilities. Anything related to slither should be run from within this container.

You can enter a shell on those containers with:

```
docker exec -it CONTAINER_ID bash
```

# Run tests

Tests are called from `test/tester.js`. Check which files you want to run.

Once done, run:

```
npm run test
```


# Scan for vulnerabilities

The *slither* tool is used to scan for vulnerabilities.

For a detailed explanation of issues:

```
CONTRACT=CONTRACT_NAME npm run scan-full
```

Or for a human readable summary:

```
CONTRACT=CONTRACT_NAME npm run scan
```


# Deploy

```
npm run deploy -- NETWORK
```

This script will deploy the contracts to the network specified in *NETWORK* (see `hardhat.config.js`).

First deploy to the *hardhat* network, then to the *sepolia* testnet, then to the mainnet.

The `deploy/deployer.js` script will deploy the contracts, and there you can choose which scripts you want to run on the deplyment workflow and variables you want to pass to those scripts.


# Verify on Etherscan

```
npm run verify -- NETWORK CONTRACT_ADDRESS ARG1 ARG2 ...

```