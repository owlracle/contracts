async function main() {
    const contractAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    const Contract = await hre.ethers.getContractFactory("Lock");
    const contract = await Contract.attach(contractAddress);
    
    const res = await contract.withdraw();

    console.log("Response:", res);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });