let returnedVars = {};

const scripts = ([
    'NewOwl',
]).map(e => require(`./${e}`));