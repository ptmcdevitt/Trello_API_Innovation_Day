// JavaScript Document
$(document).ready(function() {
    var urlParam = function(name) {
        var results = new RegExp("[#]" + name + "=([^&#]*)").exec(window.location.href);
        return results ? results[1] || null : null;
    };
    var config = {};
    var configEncoded = urlParam("simulation-config");
    if (configEncoded != null && configEncoded.length > 0) {
        config = JSON.parse(atob(configEncoded));
    }
    new Simulation(".kanban-board", config);
});

Array.prototype.average = function() {
    if (this.length == 0) return 0;
    var total = 0;
    for (var i = 0; i < this.length; i++) {
        total += this[i];
    }
    return total / this.length;
};

function normal_random(mean, variance, includeNegatives) {
    if (mean == undefined) mean = 0;
    mean = 1 * mean;
    if (variance == undefined) variance = 1;
    variance = 1 * variance;
    if (mean == 0 && variance == 0) return 0;
    var V1, V2, S, X;
    do {
        do {
            var U1 = Math.random();
            var U2 = Math.random();
            V1 = 2 * U1 - 1;
            V2 = 2 * U2 - 1;
            S = V1 * V1 + V2 * V2;
        } while (S > 1);
        X = Math.sqrt(-2 * Math.log(S) / S) * V1;
        X = mean + Math.sqrt(variance) * X;
    } while (!includeNegatives && X <= 0);
    return X;
}

function Board(ticksPerHour, simulation) {
    this.columns = null;
    this.tasks = {};
    this.ticksPerHour = ticksPerHour;
    this.droppedTasks = [];
    this.reprioritiseTasks = function(sortTasksFun) {
        for (var i = 0; i < this.columns.length - 2; i++) {
            sortTasksFun(this.columns[i].tasks);
        }
    };
    this.lastColumn = function() {
        return this.columns[this.columns.length - 1];
    };
    this.addTask = function(task) {
        this.columns[0].addTask(task);
        this.tasks[task.id] = task;
    };
    this.cleanDoneAndDropped = function() {
        var lastColumn = this.columns[this.columns.length - 1];
        lastColumn.tasks.forEach(function(task) {
            task.column = null;
            delete this.tasks[task.id];
        }.bind(this));
        lastColumn.tasks = [];
        this.droppedTasks = [];
    };
    this.getCurrentWip = function() {
        return Object.keys(this.tasks).length - this.getDoneTasksCount();
    };
    this.getColumnByName = function(columnName) {
        for (var i = 0; i < this.columns.length; i++) {
            if (this.columns[i].name == columnName) {
                return this.columns[i];
            }
        }
    };
    this.getDoneTasksCount = function(start, end) {
        return this.getDoneTasks(start, end).length;
    };
    this.getDoneTasks = function(start, end) {
        var result = [];
        var tasks = this.lastColumn().tasks;
        var columnName = this.lastColumn().name;
        if (!start || !end) return tasks.slice();
        var count = 0;
        for (var i = 0; i < tasks.length; i++) {
            var timeFinished = tasks[i].arrivalTime[columnName];
            if (timeFinished > start && timeFinished <= end) result.push(tasks[i]);
        }
        return result;
    };
    this.getCostOfDelay = function() {
        var cod = 0;
        this.columns.slice(0, this.columns.length - 1).forEach(function(column) {
            column.tasks.forEach(function(task) {
                cod += task.value.costOfDelay(simulation.time);
            }.bind(this));
        }.bind(this));
        return cod;
    };
    this.removeTasksOverLimitFromBacklog = function() {
        var limit = this.columns[0].limit();
        var freshlyRemovedTasks = this.columns[0].tasks.splice(limit, this.columns[0].tasks.length);
        this.droppedTasks = this.droppedTasks.concat(freshlyRemovedTasks);
        freshlyRemovedTasks.forEach(function(task) {
            task.column = null;
            delete this.tasks[task.id];
        }.bind(this));
    };
    this.getNotAssignedTasks = function() {
        var result = [];
        this.columns.forEach(function(column) {
            if (!column.isQueue()) {
                result.push(column.getNotAssignedTasks());
            }
        });
        return result;
    };
    this.getMostMultitaskedTasks = function() {
        var result = [];
        this.columns.forEach(function(column) {
            if (!column.isQueue()) {
                result.push(column.getMostMultitaskedTasks());
            }
        });
        return result;
    };
    this.getTasksToSwarm = function() {
        var result = [];
        this.columns.forEach(function(column) {
            if (!column.isQueue()) {
                result.push(column.getTasksToSwarm());
            }
        });
        return result;
    };
    this.createColumns = function() {
        var definitions = simulation.configuration.get("columns.definitions");
        var parentDefinitions = definitions.filter(function(element) {
            return element.children && element.children.length > 0;
        });
        var childrenDefinitions = definitions.filter(function(element) {
            return !element.children || element.children.length == 0;
        });
        var parentColumns = this.createParentColumns(parentDefinitions);
        this.columns = this.createColumnInstances(childrenDefinitions, parentDefinitions, parentColumns);
    };
    this.createParentColumns = function(parentDefinitions) {
        var result = {};
        for (var i = 0; i < parentDefinitions.length; i++) {
            var definition = parentDefinitions[i];
            result[definition.name] = new Column(definition, simulation);
        }
        return result;
    };
    this.createColumnInstances = function(childrenDefinitions, parentDefinitions, parentColumns) {
        var result = [];
        for (var i = 0; i < childrenDefinitions.length; i++) {
            var definition = childrenDefinitions[i];
            var column = new Column(definition, simulation);
            column.index = i;
            for (var j = 0; j < parentDefinitions.length; j++) {
                if (parentDefinitions[j].children.indexOf(definition.name) != -1) {
                    column.parent = parentColumns[parentDefinitions[j].name];
                    parentColumns[parentDefinitions[j].name].children.push(column);
                }
            }
            result.push(column);
        }
        return result;
    };
    this.createColumns();
}

function Column(definition, simulation) {
    this.name = definition.name;
    this.tasks = [];
    this.children = [];
    this.parent = null;
    this.ignoreLimit = definition.ignoreLimit;
    this.queue = definition.queue;
    this.simulation = simulation;
    this.label = definition.cfdLabel;
    this.boardLabel = definition.label;
    this.index = -1;
    this.configuration = simulation.configuration;
    this.getNotAssignedTasks = function() {
        var result = [];
        this.tasks.forEach(function(task) {
            if (task.peopleAssigned.length == 0 && !task.finished()) {
                result.push(task);
            }
        });
        return result;
    };
    this.getMostMultitaskedTasks = function() {
        var result = [];
        this.tasks.forEach(function(task) {
            if (task.peopleAssigned.length == 1 && task.peopleAssigned[0].tasksWorkingOn.length > 1 && !task.finished()) {
                result.push(task);
            }
        });
        result.sort(function(a, b) {
            return b.peopleAssigned[0].tasksWorkingOn.length - a.peopleAssigned[0].tasksWorkingOn.length;
        });
        return result;
    };
    this.getTasksToSwarm = function() {
        var result = [];
        this.tasks.forEach(function(task) {
            if (task.peopleAssigned.length >= 1 && task.peopleAssigned[0].tasksWorkingOn.length == 1 && !task.finished()) {
                result.push(task);
            }
        });
        result.sort(function(a, b) {
            return a.peopleAssigned.length - b.peopleAssigned.length;
        });
        return result;
    };
    this.isQueue = function() {
        return this.queue == true;
    };
    this.addTask = function(task) {
        this.tasks.push(task);
        task.column = this;
        task.arrivalTime[this.name] = this.simulation.time;
    };
    this.moveTaskTo = function(task, nextColumn) {
        this.tasks.splice(this.tasks.indexOf(task), 1);
        task.column = nextColumn;
        if (nextColumn) {
            nextColumn.tasks.push(task);
            task.arrivalTime[nextColumn.name] = this.simulation.time;
        }
    };
    this.availableSpace = function(task) {
        if (this.ignoreLimit) return true;
        var limit = this.limit();
        var numberOfTasks = this.tasks.length;
        if (this.children.length > 0) {
            var indexOfTasksColumn = this.children.indexOf(task.column);
            if (indexOfTasksColumn < 0) {
                this.children.forEach(function(subColumn) {
                    if (!subColumn.ignoreLimit) numberOfTasks += subColumn.tasks.length;
                });
            }
        }
        return limit - numberOfTasks > 0 && (!this.parent || this.parent.availableSpace(task));
    };
    this.limit = function() {
        var limit = this.configuration.get("columns.limits." + this.name);
        if (typeof limit == "string") {
            limit = parseInt(limit);
        }
        return !limit ? Number.POSITIVE_INFINITY : Math.abs(limit);
    };
    this.isFirstColumn = function() {
        return this.index == 0;
    };
}

function Configuration(externalConfig) {
    this.data = {
        version: 6,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        warmupTime: 1,
        value: {
            mean: 0,
            variation: 1e3,
            start: 0,
            duration: 10
        },
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "col0",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog"
            }, {
                name: "col1",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis"
            }, {
                name: "col2",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done"
            }, {
                name: "col3",
                queue: false,
                label: "Doing",
                cfdLabel: "Development"
            }, {
                name: "col4",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done"
            }, {
                name: "col5",
                queue: false,
                label: "Doing",
                cfdLabel: "QA"
            }, {
                name: "col6",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done"
            }, {
                name: "col7",
                queue: false,
                label: "Deployment",
                cfdLabel: "Deployment"
            }, {
                name: "col8",
                queue: true,
                label: "Done",
                cfdLabel: "Done",
                ignoreLimit: true
            }, {
                name: "colgrp0",
                label: "Analysis",
                children: [ "col1", "col2" ]
            }, {
                name: "colgrp1",
                label: "Development",
                children: [ "col3", "col4" ]
            }, {
                name: "colgrp2",
                label: "QA",
                children: [ "col5", "col6" ]
            } ],
            limits: {
                col0: null,
                col1: null,
                col2: null,
                colgrp0: 5,
                col3: null,
                col4: null,
                colgrp1: 5,
                col5: null,
                col6: null,
                colgrp2: 3,
                col7: 5
            }
        },
        team: [ {
            name: "Analyst",
            productivity: {
                col1: 100,
                col3: 0,
                col5: 0,
                col7: 0
            },
            count: 2
        }, {
            name: "Developer",
            productivity: {
                col1: 0,
                col3: 100,
                col5: 0,
                col7: 0
            },
            count: 5
        }, {
            name: "Tester",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 100,
                col7: 0
            },
            count: 3
        }, {
            name: "DevOps",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 0,
                col7: 100
            },
            count: 1
        } ],
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1
                    },
                    normal: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1,
                        "col1-variation": 2,
                        "col3-variation": 4,
                        "col5-variation": 3,
                        "col7-variation": 2
                    },
                    tshirt: {
                        col1: 14,
                        col3: 50,
                        col5: 28,
                        col7: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    };
    this.loaders = {
        1: function(externalConfig) {
            var columnDefinitions = historicalConfigs[2].columns.definitions;
            externalConfig.columns.definitions = columnDefinitions;
            externalConfig.version = 2;
        }.bind(this),
        2: function(externalConfig) {
            if (externalConfig.columns.definitions[0].name == "input") {
                externalConfig.columns.definitions = historicalConfigs[3].columns.definitions;
                var limits = {};
                var limitsKeys = Object.keys(externalConfig.columns.limits);
                var dictionary = {
                    input: "col0",
                    analysis: "col1",
                    analysisDone: "col2",
                    analysisWithQueue: "colgrp0",
                    development: "col3",
                    developmentDone: "col4",
                    developmentWithQueue: "colgrp1",
                    qa: "col5",
                    qaDone: "col6",
                    qaWithQueue: "colgrp2",
                    deployment: "col7",
                    deploymentDone: "col8"
                };
                for (var i = 0; i < limitsKeys.length; i++) {
                    var key = dictionary[limitsKeys[i]];
                    if (!key) {
                        key = limitsKeys[i];
                    }
                    limits[key] = externalConfig.columns.limits[limitsKeys[i]];
                }
                externalConfig.columns.limits = limits;
                var team = externalConfig.team;
                var teamKeys = Object.keys(team);
                var newTeam = {};
                for (var i = 0; i < teamKeys.length; i++) {
                    var key = teamKeys[i];
                    if (dictionary[key]) {
                        var personType = team[key];
                        personType.columns = personType.columns.map(function(value) {
                            return dictionary[value];
                        });
                        newTeam[dictionary[key]] = personType;
                    } else {
                        newTeam[key] = team[key];
                    }
                }
                externalConfig.team = newTeam;
                var configs = externalConfig.tasks.sizeStrategy.configs;
                Object.keys(configs).forEach(function(value) {
                    var config = configs[value];
                    Object.keys(config).forEach(function(value) {
                        if (dictionary[value]) {
                            config[dictionary[value]] = config[value];
                            delete config[value];
                        } else if (/.*-variation$/.test(value)) {
                            var subValue = /\w*/.exec(value);
                            config[dictionary[subValue] + "-variation"] = config[value];
                            delete config[value];
                        }
                    });
                });
            } else {
                for (var i = 0; i < externalConfig.columns.definitions.length; i++) {
                    delete externalConfig.columns.definitions[i]["cfdShortLabel"];
                }
            }
            externalConfig.version = 3;
        },
        3: function(externalConfig) {
            var team = externalConfig.team;
            var workingOutOfSpecialisationCoefficient = parseInt(team.workingOutOfSpecialisationCoefficient) || 0;
            var newTeam = [];
            var keys = Object.keys(team).filter(function(key) {
                return key != "workingOutOfSpecialisationCoefficient";
            });
            var dictionary = {
                Analysis: "Analyst",
                Development: "Developer",
                QA: "Tester",
                Deployment: "DevOps"
            };
            keys.forEach(function(specialistKey) {
                var memberType = {
                    count: team[specialistKey].headcount,
                    productivity: {},
                    name: ""
                };
                externalConfig.columns.definitions.forEach(function(column) {
                    if (column.name == specialistKey && dictionary[column.cfdLabel]) {
                        memberType.name = dictionary[column.cfdLabel];
                    }
                });
                keys.forEach(function(key) {
                    memberType.productivity[key] = 0;
                    if (team[specialistKey].columns.indexOf(key) != -1) {
                        if (key == specialistKey) {
                            memberType.productivity[key] = 100;
                        } else {
                            memberType.productivity[key] = workingOutOfSpecialisationCoefficient;
                        }
                    }
                });
                newTeam.push(memberType);
            });
            externalConfig.team = newTeam;
            externalConfig.version = 4;
        },
        4: function(externalConfig) {
            externalConfig.warmupTime = 0;
            externalConfig.version = 5;
        }.bind(this),
        5: function(externalConfig) {
            var value = {
                mean: 0,
                variation: 1e3,
                start: 0,
                duration: 10
            };
            externalConfig.value = value;
            externalConfig.version = 6;
        }
    };
    this.loadExternalConfig = function(externalConfig) {
        if (!externalConfig || Object.keys(externalConfig).length == 0) return;
        var version = externalConfig.version;
        if (!version) version = 1;
        var versions = Object.keys(this.loaders).sort();
        while (version <= parseInt(versions[versions.length - 1])) {
            this.loaders[version](externalConfig);
            version = externalConfig.version;
        }
        $.extend(this.data, externalConfig);
    };
    this.loadExternalConfig(externalConfig);
    this.listeners = {};
    this.listenersAfter = {};
    this.listenersActive = true;
    this.cache = {};
    this.set = function(property, newValue) {
        this.cache = {};
        var path = property.split(".");
        var enclosingObject = this.data;
        for (var i = 0; i < path.length - 1; i++) {
            enclosingObject = enclosingObject[path[i]];
        }
        var oldValue = enclosingObject[path[path.length - 1]];
        enclosingObject[path[path.length - 1]] = newValue;
        if (this.listenersActive && oldValue != newValue) {
            var launchListeners = function(list) {
                if (list[property]) {
                    for (var i = 0; i < list[property].length; i++) {
                        list[property][i](newValue, property, oldValue);
                    }
                }
            };
            launchListeners(this.listeners);
            launchListeners(this.listenersAfter);
        }
    };
    this.get = function(property) {
        var cached = this.cache[property];
        if (cached != undefined) {
            return cached;
        }
        var path = property.split(".");
        var enclosingObject = this.data;
        for (var i = 0; i < path.length - 1; i++) {
            enclosingObject = enclosingObject[path[i]];
        }
        var value = enclosingObject ? enclosingObject[path[path.length - 1]] : undefined;
        this.cache[property] = value;
        return value;
    };
    this.onChange = function(property, listenerFun) {
        this._onChange(property, listenerFun, this.listeners);
    };
    this.afterChange = function(property, listenerFun) {
        this._onChange(property, listenerFun, this.listenersAfter);
    };
    this._onChange = function(property, listenerFun, list) {
        var listenersForProperty = list[property];
        if (!listenersForProperty) {
            listenersForProperty = [];
            list[property] = listenersForProperty;
        }
        listenersForProperty.push(listenerFun);
    };
    this.pauseListeners = function() {
        this.listenersActive = false;
    };
    this.activateListeners = function() {
        this.listenersActive = true;
    };
    this.clearListeners = function() {
        this.listeners = {};
        this.listenersAfter = {};
    };
    this.getActiveStates = function() {
        var definitions = this.get("columns.definitions");
        var activeColumnNames = [];
        definitions.forEach(function(element) {
            if (!element.queue && (!element.children || element.children.length == 0)) {
                activeColumnNames.push(element.name);
            }
        });
        return activeColumnNames;
    };
}

var historicalConfigs = {
    1: {
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            limits: {
                input: null,
                analysis: null,
                analysisDone: null,
                analysisWithQueue: 5,
                development: null,
                developmentDone: null,
                developmentWithQueue: 5,
                qa: null,
                qaDone: null,
                qaWithQueue: 3,
                deployment: 5
            }
        },
        team: {
            workingOutOfSpecialisationCoefficient: 50,
            analysis: {
                headcount: 2,
                columns: [ "analysis" ]
            },
            development: {
                headcount: 5,
                columns: [ "development" ]
            },
            qa: {
                headcount: 3,
                columns: [ "qa" ]
            },
            deployment: {
                headcount: 1,
                columns: [ "deployment" ]
            }
        },
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        analysis: 2,
                        development: 7,
                        qa: 4,
                        deployment: 1
                    },
                    normal: {
                        analysis: 2,
                        development: 7,
                        qa: 4,
                        deployment: 1,
                        "analysis-variation": 2,
                        "development-variation": 4,
                        "qa-variation": 3,
                        "deployment-variation": 2
                    },
                    tshirt: {
                        analysis: 14,
                        development: 50,
                        qa: 28,
                        deployment: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    },
    2: {
        version: 2,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "input",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog",
                cfdShortLabel: "Bl"
            }, {
                name: "analysis",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis",
                cfdShortLabel: "An"
            }, {
                name: "analysisDone",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done",
                cfdShortLabel: "An Done"
            }, {
                name: "development",
                queue: false,
                label: "Doing",
                cfdLabel: "Development",
                cfdShortLabel: "Dev"
            }, {
                name: "developmentDone",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done",
                cfdShortLabel: "Dev Done"
            }, {
                name: "qa",
                queue: false,
                label: "Doing",
                cfdLabel: "QA",
                cfdShortLabel: "QA"
            }, {
                name: "qaDone",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done",
                cfdShortLabel: "QA Done"
            }, {
                name: "deployment",
                queue: false,
                label: "Doing",
                cfdLabel: "Deployment",
                cfdShortLabel: "Depl"
            }, {
                name: "deploymentDone",
                queue: true,
                label: "Done",
                cfdLabel: "Deployment Done",
                cfdShortLabel: "Depl Done",
                ignoreLimit: true
            }, {
                name: "analysisWithQueue",
                label: "Analysis",
                children: [ "analysis", "analysisDone" ]
            }, {
                name: "developmentWithQueue",
                label: "Development",
                children: [ "development", "developmentDone" ]
            }, {
                name: "qaWithQueue",
                label: "QA",
                children: [ "qa", "qaDone" ]
            }, {
                name: "deploymentWithQueue",
                label: "Deployment",
                children: [ "deployment", "deploymentDone" ]
            } ],
            limits: {
                input: null,
                analysis: null,
                analysisDone: null,
                analysisWithQueue: 5,
                development: null,
                developmentDone: null,
                developmentWithQueue: 5,
                qa: null,
                qaDone: null,
                qaWithQueue: 3,
                deployment: 5
            }
        },
        team: {
            workingOutOfSpecialisationCoefficient: 50,
            analysis: {
                headcount: 2,
                columns: [ "analysis" ]
            },
            development: {
                headcount: 5,
                columns: [ "development" ]
            },
            qa: {
                headcount: 3,
                columns: [ "qa" ]
            },
            deployment: {
                headcount: 1,
                columns: [ "deployment" ]
            }
        },
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        analysis: 2,
                        development: 7,
                        qa: 4,
                        deployment: 1
                    },
                    normal: {
                        analysis: 2,
                        development: 7,
                        qa: 4,
                        deployment: 1,
                        "analysis-variation": 2,
                        "development-variation": 4,
                        "qa-variation": 3,
                        "deployment-variation": 2
                    },
                    tshirt: {
                        analysis: 14,
                        development: 50,
                        qa: 28,
                        deployment: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    },
    3: {
        version: 3,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "col0",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog"
            }, {
                name: "col1",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis"
            }, {
                name: "col2",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done"
            }, {
                name: "col3",
                queue: false,
                label: "Doing",
                cfdLabel: "Development"
            }, {
                name: "col4",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done"
            }, {
                name: "col5",
                queue: false,
                label: "Doing",
                cfdLabel: "QA"
            }, {
                name: "col6",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done"
            }, {
                name: "col7",
                queue: false,
                label: "Deployment",
                cfdLabel: "Deployment"
            }, {
                name: "col8",
                queue: true,
                label: "Done",
                cfdLabel: "Done",
                ignoreLimit: true
            }, {
                name: "colgrp0",
                label: "Analysis",
                children: [ "col1", "col2" ]
            }, {
                name: "colgrp1",
                label: "Development",
                children: [ "col3", "col4" ]
            }, {
                name: "colgrp2",
                label: "QA",
                children: [ "col5", "col6" ]
            } ],
            limits: {
                col0: null,
                col1: null,
                col2: null,
                colgrp0: 5,
                col3: null,
                col4: null,
                colgrp1: 5,
                col5: null,
                col6: null,
                colgrp2: 3,
                col7: 5
            }
        },
        team: {
            workingOutOfSpecialisationCoefficient: 50,
            col1: {
                headcount: 2,
                columns: [ "col1" ]
            },
            col3: {
                headcount: 5,
                columns: [ "col3" ]
            },
            col5: {
                headcount: 3,
                columns: [ "col5" ]
            },
            col7: {
                headcount: 1,
                columns: [ "col7" ]
            }
        },
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1
                    },
                    normal: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1,
                        "col1-variation": 2,
                        "col3-variation": 4,
                        "col5-variation": 3,
                        "col7-variation": 2
                    },
                    tshirt: {
                        col1: 14,
                        col3: 50,
                        col5: 28,
                        col7: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    },
    4: {
        version: 4,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "col0",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog"
            }, {
                name: "col1",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis"
            }, {
                name: "col2",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done"
            }, {
                name: "col3",
                queue: false,
                label: "Doing",
                cfdLabel: "Development"
            }, {
                name: "col4",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done"
            }, {
                name: "col5",
                queue: false,
                label: "Doing",
                cfdLabel: "QA"
            }, {
                name: "col6",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done"
            }, {
                name: "col7",
                queue: false,
                label: "Deployment",
                cfdLabel: "Deployment"
            }, {
                name: "col8",
                queue: true,
                label: "Done",
                cfdLabel: "Done",
                ignoreLimit: true
            }, {
                name: "colgrp0",
                label: "Analysis",
                children: [ "col1", "col2" ]
            }, {
                name: "colgrp1",
                label: "Development",
                children: [ "col3", "col4" ]
            }, {
                name: "colgrp2",
                label: "QA",
                children: [ "col5", "col6" ]
            } ],
            limits: {
                col0: null,
                col1: null,
                col2: null,
                colgrp0: 5,
                col3: null,
                col4: null,
                colgrp1: 5,
                col5: null,
                col6: null,
                colgrp2: 3,
                col7: 5
            }
        },
        team: [ {
            name: "Analyst",
            productivity: {
                col1: 100,
                col3: 0,
                col5: 0,
                col7: 0
            },
            count: 2
        }, {
            name: "Developer",
            productivity: {
                col1: 0,
                col3: 100,
                col5: 0,
                col7: 0
            },
            count: 5
        }, {
            name: "Tester",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 100,
                col7: 0
            },
            count: 3
        }, {
            name: "DevOps",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 0,
                col7: 100
            },
            count: 1
        } ],
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1
                    },
                    normal: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1,
                        "col1-variation": 2,
                        "col3-variation": 4,
                        "col5-variation": 3,
                        "col7-variation": 2
                    },
                    tshirt: {
                        col1: 14,
                        col3: 50,
                        col5: 28,
                        col7: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    },
    5: {
        version: 5,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        warmupTime: 1,
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "col0",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog"
            }, {
                name: "col1",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis"
            }, {
                name: "col2",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done"
            }, {
                name: "col3",
                queue: false,
                label: "Doing",
                cfdLabel: "Development"
            }, {
                name: "col4",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done"
            }, {
                name: "col5",
                queue: false,
                label: "Doing",
                cfdLabel: "QA"
            }, {
                name: "col6",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done"
            }, {
                name: "col7",
                queue: false,
                label: "Deployment",
                cfdLabel: "Deployment"
            }, {
                name: "col8",
                queue: true,
                label: "Done",
                cfdLabel: "Done",
                ignoreLimit: true
            }, {
                name: "colgrp0",
                label: "Analysis",
                children: [ "col1", "col2" ]
            }, {
                name: "colgrp1",
                label: "Development",
                children: [ "col3", "col4" ]
            }, {
                name: "colgrp2",
                label: "QA",
                children: [ "col5", "col6" ]
            } ],
            limits: {
                col0: null,
                col1: null,
                col2: null,
                colgrp0: 5,
                col3: null,
                col4: null,
                colgrp1: 5,
                col5: null,
                col6: null,
                colgrp2: 3,
                col7: 5
            }
        },
        team: [ {
            name: "Analyst",
            productivity: {
                col1: 100,
                col3: 0,
                col5: 0,
                col7: 0
            },
            count: 2
        }, {
            name: "Developer",
            productivity: {
                col1: 0,
                col3: 100,
                col5: 0,
                col7: 0
            },
            count: 5
        }, {
            name: "Tester",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 100,
                col7: 0
            },
            count: 3
        }, {
            name: "DevOps",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 0,
                col7: 100
            },
            count: 1
        } ],
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1
                    },
                    normal: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1,
                        "col1-variation": 2,
                        "col3-variation": 4,
                        "col5-variation": 3,
                        "col7-variation": 2
                    },
                    tshirt: {
                        col1: 14,
                        col3: 50,
                        col5: 28,
                        col7: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    },
    6: {
        version: 6,
        maxTasksOnOnePerson: 2,
        maxPeopleOnOneTask: 2,
        warmupTime: 1,
        value: {
            mean: 0,
            variation: 1e3,
            start: 0,
            duration: 10
        },
        stats: {
            noOfDaysForMovingAverage: 5
        },
        columns: {
            prioritisationStrategy: "fifo",
            definitions: [ {
                name: "col0",
                queue: true,
                label: "Backlog",
                cfdLabel: "Backlog"
            }, {
                name: "col1",
                queue: false,
                label: "Doing",
                cfdLabel: "Analysis"
            }, {
                name: "col2",
                queue: true,
                label: "Done",
                cfdLabel: "Analysis Done"
            }, {
                name: "col3",
                queue: false,
                label: "Doing",
                cfdLabel: "Development"
            }, {
                name: "col4",
                queue: true,
                label: "Done",
                cfdLabel: "Development Done"
            }, {
                name: "col5",
                queue: false,
                label: "Doing",
                cfdLabel: "QA"
            }, {
                name: "col6",
                queue: true,
                label: "Done",
                cfdLabel: "QA Done"
            }, {
                name: "col7",
                queue: false,
                label: "Deployment",
                cfdLabel: "Deployment"
            }, {
                name: "col8",
                queue: true,
                label: "Done",
                cfdLabel: "Done",
                ignoreLimit: true
            }, {
                name: "colgrp0",
                label: "Analysis",
                children: [ "col1", "col2" ]
            }, {
                name: "colgrp1",
                label: "Development",
                children: [ "col3", "col4" ]
            }, {
                name: "colgrp2",
                label: "QA",
                children: [ "col5", "col6" ]
            } ],
            limits: {
                col0: null,
                col1: null,
                col2: null,
                colgrp0: 5,
                col3: null,
                col4: null,
                colgrp1: 5,
                col5: null,
                col6: null,
                colgrp2: 3,
                col7: 5
            }
        },
        team: [ {
            name: "Analyst",
            productivity: {
                col1: 100,
                col3: 0,
                col5: 0,
                col7: 0
            },
            count: 2
        }, {
            name: "Developer",
            productivity: {
                col1: 0,
                col3: 100,
                col5: 0,
                col7: 0
            },
            count: 5
        }, {
            name: "Tester",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 100,
                col7: 0
            },
            count: 3
        }, {
            name: "DevOps",
            productivity: {
                col1: 0,
                col3: 0,
                col5: 0,
                col7: 100
            },
            count: 1
        } ],
        tasks: {
            arrivalStrategy: {
                current: "up-to-limit",
                configs: {
                    scrum: {
                        length: 10,
                        tasks: 55,
                        "include-existing": false
                    },
                    "constant-push": {
                        demand: 5.5
                    },
                    "random-push": {
                        demand: 5.5,
                        "batch-size": 1
                    }
                }
            },
            sizeStrategy: {
                current: "constant",
                configs: {
                    constant: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1
                    },
                    normal: {
                        col1: 2,
                        col3: 7,
                        col5: 4,
                        col7: 1,
                        "col1-variation": 2,
                        "col3-variation": 4,
                        "col5-variation": 3,
                        "col7-variation": 2
                    },
                    tshirt: {
                        col1: 14,
                        col3: 50,
                        col5: 28,
                        col7: 8,
                        "small-probability": 45,
                        "medium-probability": 30,
                        "large-probability": 20,
                        "xlarge-probability": 5,
                        "small-effort": 3,
                        "medium-effort": 10,
                        "large-effort": 25,
                        "xlarge-effort": 75
                    }
                }
            }
        }
    }
};

var personIndex = 1;

function Person(name, productivity, typeIndex) {
    this.tasksWorkingOn = [];
    this.productivityPerHour = 60;
    this.productivity = productivity;
    this.name = name;
    this.typeIndex = typeIndex;
    this.id = personIndex++;
    this.assignTo = function(task) {
        this.tasksWorkingOn.push(task);
        task.peopleAssigned.push(this);
    };
    this.unassignFromAll = function() {
        for (var i = 0; i < this.tasksWorkingOn.length; i++) {
            var task = this.tasksWorkingOn[i];
            task.peopleAssigned.splice(task.peopleAssigned.indexOf(this), 1);
        }
        this.tasksWorkingOn = [];
    };
    this.work = function(ticksPerHour, time) {
        if (this.tasksWorkingOn.length == 0) return;
        var workPerTask = this.productivityPerHour / this.tasksWorkingOn.length / ticksPerHour;
        this.tasksWorkingOn.forEach(function(task) {
            task.work(workPerTask * (this.productivity[task.column.name] / 100), time, this);
            if (task.finished()) {
                task.unassignPeople();
            }
        }.bind(this));
    };
    this.isAllowedToWorkIn = function(columnName) {
        return this.productivity[columnName] > 0;
    };
}

function Simulation(hookSelector, externalConfig) {
    this.configuration = new Configuration(externalConfig);
    this.hourLengthInSeconds = 1;
    this.ticksPerHour = 12;
    this.time;
    this.taskCounter;
    this.timeoutHandler;
    this.gui = new GUI(hookSelector, this, this.configuration);
    this.board;
    this.stats;
    this.team;
    this.initBasics = function() {
        this.configuration.clearListeners();
        this.time = 0;
        this.taskCounter = 1;
        this.team = new Team(this.configuration);
        this.board = new Board(this.ticksPerHour, this);
        this.stats = new Stats(this, this.configuration);
        this.team.initTeam();
        this.gui.init();
    };
    this.play = function() {
        if (!this.timeoutHandler) this.timeoutHandler = setTimeout(this.tick.bind(this), this.hourLengthInSeconds * 1e3 / this.ticksPerHour);
    };
    this.stop = function() {
        clearTimeout(this.timeoutHandler);
        this.timeoutHandler = null;
        this.initBasics();
    };
    this.pause = function() {
        clearTimeout(this.timeoutHandler);
        this.timeoutHandler = null;
    };
    this.isRunning = function() {
        return this.timeoutHandler != null;
    };
    this.tick = function() {
        this.timeoutHandler = null;
        this.addNewTasks(this.board);
        this.board.reprioritiseTasks(this.prioritisationStrategies[this.configuration.get("columns.prioritisationStrategy")]);
        this.board.removeTasksOverLimitFromBacklog();
        this.doWork();
        this.moveTasks(this.board.columns);
        this.assignTeamMembersToTasks();
        this.stats.recalculateStats(this);
        this.removeDoneTasks();
        this.gui.update(this.board, this.stats);
        this.play();
        this.time += 60 / this.ticksPerHour;
    };
    this.taskArrivalStrategies = {
        scrum: function(createTaskFunction) {
            var length = this.configuration.get("tasks.arrivalStrategy.configs.scrum.length");
            var tasks = this.configuration.get("tasks.arrivalStrategy.configs.scrum.tasks");
            var includeExisting = this.configuration.get("tasks.arrivalStrategy.configs.scrum.include-existing");
            if (includeExisting) tasks = tasks - this.board.getCurrentWip();
            if (this.time / (60 * 8) % length == 0) {
                for (var i = 0; i < tasks; i++) {
                    this.board.addTask(createTaskFunction());
                }
            }
        }.bind(this),
        "up-to-limit": function(createTaskFunction) {
            var limit = this.board.columns[0].limit();
            if (limit == Number.POSITIVE_INFINITY) limit = 1;
            for (var i = this.board.columns[0].tasks.length; i < limit; i++) {
                this.board.addTask(createTaskFunction());
            }
        }.bind(this),
        "constant-push": function(createTaskFunction) {
            var demand = this.configuration.get("tasks.arrivalStrategy.configs.constant-push.demand");
            var ticksPerDay = 8 * this.ticksPerHour;
            var distanceInTicks = ticksPerDay / demand;
            var tickDuration = 60 / this.ticksPerHour;
            var currentTick = this.time / tickDuration;
            var deltaIndex = currentTick - Math.floor(currentTick / distanceInTicks) * distanceInTicks;
            var spawnTasks = deltaIndex < 1;
            if (spawnTasks) {
                var noOfTasksToSpawn = 1;
                if (demand > ticksPerDay) {
                    noOfTasksToSpawn += Math.floor(demand / ticksPerDay) - 1;
                    var distanceInTicks = ticksPerDay / (demand % ticksPerDay);
                    var deltaIndex = currentTick - Math.floor(currentTick / distanceInTicks) * distanceInTicks;
                    var spawnTask = deltaIndex < 1;
                    noOfTasksToSpawn += spawnTask ? 1 : 0;
                }
                for (var i = 0; i < noOfTasksToSpawn; i++) {
                    this.board.addTask(createTaskFunction());
                }
            }
        }.bind(this),
        "random-push": function(createTaskFunction) {
            var demand = this.configuration.get("tasks.arrivalStrategy.configs.random-push.demand");
            var batchSize = this.configuration.get("tasks.arrivalStrategy.configs.random-push.batch-size");
            var ticksPerDay = 8 * this.ticksPerHour;
            var probabilityOfSpawningNow = demand / ticksPerDay / batchSize;
            if (Math.random() < probabilityOfSpawningNow) {
                batchSize = Math.max(demand / ticksPerDay, batchSize);
                var noOfTasksToSpawn = Math.max(0, Math.round(normal_random(batchSize, batchSize / 3, true)));
                for (var i = 0; i < noOfTasksToSpawn; i++) {
                    this.board.addTask(createTaskFunction());
                }
            }
        }.bind(this)
    };
    this.taskSizeStrategies = {
        constant: function(id, time) {
            var conf = this.configuration.get("tasks.sizeStrategy.configs.constant");
            var activeStates = this.configuration.getActiveStates();
            var taskConfig = {};
            activeStates.forEach(function(element) {
                taskConfig[element] = conf[element] * 60;
            });
            return this.createTask(taskConfig);
        }.bind(this),
        normal: function(id, time) {
            var conf = this.configuration.get("tasks.sizeStrategy.configs.normal");
            var activeStates = this.configuration.getActiveStates();
            var taskConfig = {};
            activeStates.forEach(function(element) {
                taskConfig[element] = normal_random(conf[element], conf[element + "-variation"]) * 60;
            });
            return this.createTask(taskConfig);
        }.bind(this),
        tshirt: function(id, time) {
            var conf = this.configuration.get("tasks.sizeStrategy.configs.tshirt");
            var smallProbability = parseFloat(conf["small-probability"]);
            var mediumProbability = parseFloat(conf["medium-probability"]);
            var largeProbability = parseFloat(conf["large-probability"]);
            var xlargeProbability = parseFloat(conf["xlarge-probability"]);
            var tshirtSizeRandom = Math.random() * (smallProbability + mediumProbability + largeProbability + xlargeProbability);
            var size = "small";
            if (tshirtSizeRandom > smallProbability) size = "medium";
            if (tshirtSizeRandom > smallProbability + mediumProbability) size = "large";
            if (tshirtSizeRandom > smallProbability + mediumProbability + largeProbability) size = "xlarge";
            var totalSize = parseFloat(conf[size + "-effort"]);
            var activeStates = this.configuration.getActiveStates();
            var taskConfig = {};
            var sum = 0;
            activeStates.forEach(function(element) {
                sum += conf[element];
            });
            activeStates.forEach(function(element) {
                var percentage = parseFloat(conf[element]);
                var effort = 60 * totalSize * percentage / sum;
                taskConfig[element] = normal_random(effort, effort / 2);
            });
            return this.createTask(taskConfig);
        }.bind(this)
    };
    this.createTask = function(taskConfig) {
        var warmupTime = this.configuration.get("warmupTime") * 60;
        var valueMean = this.configuration.get("value.mean");
        var valueVariation = this.configuration.get("value.variation");
        var start = this.time + this.configuration.get("value.start") * 8 * 60;
        var durationInDays = this.configuration.get("value.duration");
        var value = new Value(start, durationInDays, normal_random(valueMean, valueVariation, false));
        return new Task((this.taskCounter++), this.time, taskConfig, normal_random(warmupTime, warmupTime / 2, false), value);
    };
    this.prioritisationStrategies = {
        fifo: function(tasksList) {},
        value: function(tasksList) {
            tasksList.sort(function(taskA, taskB) {
                return taskB.value.totalValue() - taskA.value.totalValue();
            }.bind(this));
        }.bind(this),
        cd3: function(tasksList) {
            tasksList.sort(function(taskA, taskB) {
                return taskB.value.costOfDelay(this.time, this.stats.leadTime.getAvg()) / taskB.getRemainingWork() - taskA.value.costOfDelay(this.time, this.stats.leadTime.getAvg()) / taskA.getRemainingWork();
            }.bind(this));
        }.bind(this)
    };
    this.addNewTasks = function() {
        var sizeStrategy = this.configuration.get("tasks.sizeStrategy.current");
        var arrivalStrategy = this.configuration.get("tasks.arrivalStrategy.current");
        this.taskArrivalStrategies[arrivalStrategy](this.taskSizeStrategies[sizeStrategy]);
    };
    this.moveTasks = function(columns) {
        var changed = true;
        while (changed) {
            changed = false;
            for (var i = 0; i < columns.length; i++) {
                var column = columns[i];
                for (var j = 0; j < column.tasks.length; j++) {
                    var task = column.tasks[j];
                    if (task.finished()) {
                        var nextColumn = this.findNextColumn(task, columns);
                        if (nextColumn != column) {
                            changed = true;
                            column.moveTaskTo(task, nextColumn);
                        }
                    }
                }
            }
        }
    };
    this.removeDoneTasks = function() {
        if (this.time % (60 * 8) == 0) this.board.cleanDoneAndDropped();
    };
    this.findNextColumn = function(task, columns) {
        var column = task.column;
        var index = column.index;
        while (column && task.finished(column) && (!columns[index + 1] || columns[index + 1].availableSpace(task))) {
            column = columns[++index];
        }
        if (!column) {
            column = columns[columns.length - 1];
        }
        return column;
    };
    this.assignTeamMembersToTasks = function() {
        var unassignedTasks = this.board.getNotAssignedTasks();
        this.assignNonWorkingToUnassignedTasks(unassignedTasks);
        this.assignWorkingToUnassignedTasksIfPossible(unassignedTasks);
        this.assignNonWorkingToMultitaskedTasks();
        this.swarmNonWorking();
    };
    this.assignNonWorkingToUnassignedTasks = function(unassignedTasks) {
        var membersSortedBySkill = this.team.membersSortedBySkill;
        membersSortedBySkill.forEach(function(personAndActivity) {
            if (personAndActivity.person.tasksWorkingOn.length != 0) return;
            var task = unassignedTasks[personAndActivity.activityIndex].shift();
            if (task) {
                personAndActivity.person.assignTo(task);
            }
        });
    };
    this.assignWorkingToUnassignedTasksIfPossible = function(unassignedTasks) {
        var membersSortedBySkill = this.team.membersSortedBySkill;
        var maxTasksOnOnePerson = this.configuration.get("maxTasksOnOnePerson");
        var workingMembers = this.team.getPeopleAssignedToAtLeastOneTaskAndLessThan(maxTasksOnOnePerson);
        while (workingMembers.length > 0) {
            var currentTaskCount = workingMembers[0].tasksWorkingOn.length;
            membersSortedBySkill.forEach(function(personAndActivity) {
                if (personAndActivity.person.tasksWorkingOn.length != currentTaskCount) return;
                if (personAndActivity.person.tasksWorkingOn[0].peopleAssigned.length > 1) return;
                var task = unassignedTasks[personAndActivity.activityIndex].shift();
                if (task) {
                    personAndActivity.person.assignTo(task);
                }
            });
            workingMembers = workingMembers.filter(function(person) {
                return person.tasksWorkingOn.length != currentTaskCount && person.tasksWorkingOn.length < maxTasksOnOnePerson;
            });
        }
    };
    this.assignNonWorkingToMultitaskedTasks = function() {
        var membersSortedBySkill = this.team.membersSortedBySkill;
        var multitaskedTasks = this.board.getMostMultitaskedTasks();
        membersSortedBySkill.forEach(function(personAndActivity) {
            if (personAndActivity.person.tasksWorkingOn.length != 0) return;
            var task = multitaskedTasks[personAndActivity.activityIndex].shift();
            if (task) {
                task.unassignPeople();
                personAndActivity.person.assignTo(task);
            }
        });
    };
    this.swarmNonWorking = function() {
        var membersSortedBySkill = this.team.membersSortedBySkill;
        var maxPeopleOnOneTask = this.configuration.get("maxPeopleOnOneTask");
        var tasksToSwarm = this.board.getTasksToSwarm();
        while (tasksToSwarm.reduce(function(sum, element) {
            return sum + element.length;
        }, 0) > 0) {
            var lowestCount = Math.min.apply(null, tasksToSwarm.map(function(element) {
                return element.length > 0 ? element[0].peopleAssigned.length : Number.POSITIVE_INFINITY;
            }));
            if (lowestCount >= maxPeopleOnOneTask) break;
            var filteredTasksToSwarm = tasksToSwarm.map(function(tasksInColumn) {
                return tasksInColumn.filter(function(task) {
                    return task.peopleAssigned.length == lowestCount;
                });
            });
            membersSortedBySkill.forEach(function(personAndActivity) {
                if (personAndActivity.person.tasksWorkingOn.length != 0) return;
                var tasksInColumn = filteredTasksToSwarm[personAndActivity.activityIndex];
                for (var i = 0; i < tasksInColumn.length; i++) {
                    var task = tasksInColumn[i];
                    if (task.peopleAssigned.indexOf(personAndActivity.person) < 0) {
                        personAndActivity.person.assignTo(task);
                        tasksInColumn.splice(tasksInColumn.indexOf(task), 1);
                        return;
                    }
                }
            });
            filteredTasksToSwarm.forEach(function(tasksInColumn, index) {
                tasksInColumn.forEach(function(task) {
                    tasksToSwarm[index].splice(tasksToSwarm[index].indexOf(task), 1);
                });
            });
        }
    };
    this.doWork = function() {
        this.team.doWork(this.ticksPerHour, this.time);
    };
    this.initBasics();
}

function Stats(simulation, configuration) {
    function DataSet(stats, interval, avgMultiplier, eventsAsArrays) {
        this.events = [];
        this.avg = null;
        this.avgHistory = [];
        this.interval = interval || 1;
        this.avgMultiplier = avgMultiplier || 1;
        this.stats = stats;
        this.updateHistoryFrom = 0;
        this.eventsAsArrays = eventsAsArrays;
        this.getAvg = function(index, forceRecalculate) {
            index = index == undefined ? this.events.length - 1 : index;
            if (forceRecalculate || !this.avg) {
                var subArray = this.events.slice(Math.max(0, index - this.stats.dataPointsToRemember / this.interval), index);
                if (this.eventsAsArrays) {
                    subArray = [].concat.apply([], subArray);
                }
                this.avg = subArray.average() * this.avgMultiplier;
            }
            return this.avg;
        };
        this.getAvgHistory = function() {
            for (var i = this.updateHistoryFrom; i < this.events.length; i++) {
                this.avgHistory.push({
                    x: i * this.interval,
                    y: this.getAvg(i, true)
                });
            }
            this.updateHistoryFrom = this.events.length;
            return this.avgHistory;
        };
        this.recalculateAvg = function() {
            this.avgHistory = [];
            this.updateHistoryFrom = 0;
        };
        this.addEvent = function(event) {
            this.events.push(event);
            this.avg = null;
        };
    }
    this.configuration = configuration;
    this.dataPointsToRemember = 8 * this.configuration.get("stats.noOfDaysForMovingAverage");
    this.cfdData = {};
    this.wip = new DataSet(this);
    this.throughput = new DataSet(this, 1, 8);
    this.availablePeople = new DataSet(this);
    this.busyPeople = new DataSet(this);
    this.capacityUtilisation = new DataSet(this);
    this.leadTime = new DataSet(this, 1, 1 / (8 * 60), true);
    this.touchTimePercent = new DataSet(this, 1, 1, true);
    this.costOfDelay = new DataSet(this, 8);
    this.valueDelivered = new DataSet(this, 8);
    this.valueDropped = new DataSet(this, 8);
    this.leadTimesHistory = [];
    for (var i = 0; i < simulation.board.columns.length; i++) {
        this.cfdData[simulation.board.columns[i].name] = [];
    }
    this.changeNoOfDaysForCountingAverages = function(newNoOfDays) {
        newNoOfDays = parseInt(newNoOfDays);
        if (Number.isNaN(newNoOfDays) || newNoOfDays <= 0) return;
        this.dataPointsToRemember = newNoOfDays * 8;
        this.wip.recalculateAvg();
        this.throughput.recalculateAvg();
        this.capacityUtilisation.recalculateAvg();
        this.leadTime.recalculateAvg();
        this.touchTimePercent.recalculateAvg();
        this.costOfDelay.recalculateAvg();
        this.valueDelivered.recalculateAvg();
        this.valueDropped.recalculateAvg();
    };
    this.configuration.onChange("stats.noOfDaysForMovingAverage", this.changeNoOfDaysForCountingAverages.bind(this));
    this.recalculateStats = function(simulation) {
        this.calculateAvailablePeople(simulation);
        this.calculateWip(simulation);
        if (simulation.time % 60 != 0) return;
        this.updateCfdData(simulation.board, simulation.time);
        var lastColumn = simulation.board.lastColumn();
        var leadTimes = [];
        var touchTimes = [];
        lastColumn.tasks.forEach(function(task) {
            var leadTime = task.getLeadTime();
            var touchTime = task.getTouchCount() * (60 / simulation.ticksPerHour);
            leadTimes.push(leadTime);
            touchTimes.push(100 * touchTime / leadTime);
        });
        this.leadTime.addEvent(leadTimes);
        this.touchTimePercent.addEvent(touchTimes);
        this.wip.addEvent(this.currentWip / simulation.ticksPerHour);
        this.currentWip = 0;
        this.throughput.addEvent(simulation.board.getDoneTasksCount(simulation.time - 60, simulation.time));
        this.availablePeople.addEvent(this.notWorkingCountSummed / simulation.ticksPerHour);
        this.busyPeople.addEvent(this.busyCountSummed / simulation.ticksPerHour);
        var lastPos = this.busyPeople.events.length - 1;
        this.capacityUtilisation.addEvent(100 * this.busyPeople.events[lastPos] / (this.busyPeople.events[lastPos] + this.availablePeople.events[lastPos]));
        this.notWorkingCountSummed = 0;
        this.busyCountSummed = 0;
        if (simulation.time % (60 * 8) == 0) {
            var cod = simulation.board.getCostOfDelay();
            this.costOfDelay.addEvent(cod);
            var tasksDone = simulation.board.getDoneTasks();
            var valueDelivered = 0;
            for (var i = 0; i < tasksDone.length; i++) {
                valueDelivered += tasksDone[i].value.remainingValue(simulation.time);
            }
            this.valueDelivered.addEvent(valueDelivered);
            var tasksDropped = simulation.board.droppedTasks;
            var valueDroppedSummed = 0;
            for (var i = 0; i < tasksDropped.length; i++) {
                valueDroppedSummed += tasksDropped[i].value.totalValue();
            }
            this.valueDropped.addEvent(valueDroppedSummed);
        }
        this.updateHistory(simulation.time);
    };
    this.notWorkingCountSummed = 0;
    this.busyCountSummed = 0;
    this.calculateAvailablePeople = function(simulation) {
        var notWorkingCount = simulation.team.getNotWorking().length;
        var teamSize = simulation.team.members.length;
        this.notWorkingCountSummed += notWorkingCount;
        this.busyCountSummed += teamSize - notWorkingCount;
    };
    this.currentWip = 0;
    this.calculateWip = function(simulation) {
        var currentWip = simulation.board.getCurrentWip();
        this.currentWip += currentWip;
    };
    this.updateHistory = function(time) {
        var tasks = simulation.board.getDoneTasks(simulation.time - 60, simulation.time);
        for (var i = 0; i < tasks.length; i++) {
            this.leadTimesHistory.push({
                x: time,
                y: tasks[i].getLeadTime() / 60 / 8
            });
        }
    };
    this.updateCfdData = function(board, time) {
        if (time % (60 * 8) != 0) return;
        var day = time / 60 / 8;
        for (var i = 0; i < board.columns.length - 1; i++) {
            this.cfdData[board.columns[i].name].push({
                x: day,
                y: board.columns[i].tasks.length
            });
        }
        var lastColumnName = board.columns[board.columns.length - 1].name;
        var lastColumn = this.cfdData[lastColumnName];
        var lastDoneCount = lastColumn[lastColumn.length - 1] ? lastColumn[lastColumn.length - 1].y : 0;
        lastColumn.push({
            x: day,
            y: board.columns[board.columns.length - 1].tasks.length + lastDoneCount
        });
    };
}

function Task(taskId, time, size, warmupTime, value) {
    this.id = "Task" + taskId;
    this.label = "#" + taskId;
    this.created = time;
    this.size = $.extend({}, size);
    this.originalSize = $.extend({}, size);
    this.column = null;
    this.peopleAssigned = [];
    this.arrivalTime = {};
    this.value = value;
    this.value.task = this;
    this.touchCounter = 0;
    this.lastTouchedTime = -1;
    this.warmupTime = warmupTime;
    this.peopleWarmingUp = {};
    this.finished = function(column) {
        if (!column) {
            column = this.column;
        }
        return this.size[column.name] <= 0 || !this.size[column.name];
    };
    this.getRemainingWork = function() {
        var sizeSummed = 0;
        Object.keys(this.size).forEach(function(key) {
            sizeSummed += Math.max(0, this.size[key]);
        }.bind(this));
        return sizeSummed;
    };
    this.work = function(amount, time, person) {
        if (time != this.lastTouchedTime) {
            this.touchCounter++;
            this.lastTouchedTime = time;
            Object.keys(this.peopleWarmingUp).forEach(function(warmingUpPerson) {
                var contains = false;
                for (var i = 0; i < this.peopleAssigned.length; i++) {
                    if (this.peopleAssigned[i].id == warmingUpPerson) {
                        contains = true;
                        break;
                    }
                }
                if (!contains) {
                    delete this.peopleWarmingUp[warmingUpPerson];
                }
            }.bind(this));
        }
        var warmingCount = this.peopleWarmingUp[person.id];
        if (warmingCount == undefined) {
            warmingCount = this.warmupTime;
        }
        if (warmingCount > 0) {
            this.peopleWarmingUp[person.id] = warmingCount -= amount;
        } else {
            this.size[this.column.name] -= amount;
        }
    };
    this.unassignPeople = function() {
        this.peopleAssigned.forEach(function(person) {
            person.tasksWorkingOn.splice(person.tasksWorkingOn.indexOf(this), 1);
        }.bind(this));
        this.peopleAssigned = [];
    };
    this.getLeadTime = function() {
        return this.arrivalTime[this.column.name] - this.created;
    };
    this.getTouchCount = function() {
        return this.touchCounter;
    };
}

function Team(configuration) {
    this.members = [];
    this.membersSortedBySkill = [];
    this.configuration = configuration;
    this.doWork = function(ticksPerHour, time) {
        this.members.forEach(function(person) {
            person.work(ticksPerHour, time);
        });
    };
    this.getNotWorking = function() {
        var result = [];
        this.members.forEach(function(person) {
            if (person.tasksWorkingOn.length == 0) result.push(person);
        });
        return result;
    };
    this.getPeopleAssignedToAtLeastOneTaskAndLessThan = function(lessThan) {
        return this.members.filter(function(person) {
            return person.tasksWorkingOn.length > 0 && person.tasksWorkingOn.length < lessThan && person.tasksWorkingOn[0].peopleAssigned.length == 1;
        }).sort(function(a, b) {
            return a.tasksWorkingOn.length - b.tasksWorkingOn.length;
        });
    };
    this.recreateTeam = function(newConfig) {
        for (var i = 0; i < this.members.length; i++) {
            this.members[i].unassignFromAll();
        }
        this.members = [];
        for (var i = 0; i < newConfig.length; i++) {
            for (var j = 0; j < newConfig[i].count; j++) {
                this.members.push(new Person(newConfig[i].name, newConfig[i].productivity, i));
            }
        }
        this.recreateMembersSortedBySkill();
    };
    this.updateTeamNamesAndCount = function(newConfig) {
        newConfig.forEach(function(memberType, index) {
            var membersOfType = this.members.filter(function(member) {
                return member.typeIndex == index;
            });
            membersOfType.forEach(function(member) {
                member.name = memberType.name;
            });
            if (membersOfType.length < memberType.count) {
                for (var i = 0; i < memberType.count - membersOfType.length; i++) {
                    this.members.push(new Person(memberType.name, memberType.productivity, index));
                }
            } else if (membersOfType.length > memberType.count) {
                for (var i = 0; i < membersOfType.length - memberType.count; i++) {
                    this.members.splice(this.members.indexOf(membersOfType[i]), 1);
                    membersOfType[i].unassignFromAll();
                }
            }
        }.bind(this));
        this.recreateMembersSortedBySkill();
    };
    this.recreateMembersSortedBySkill = function() {
        this.membersSortedBySkill = [];
        var membersGroupedAndSorted = [];
        var activities = this.configuration.getActiveStates();
        for (var i = 0; i < activities.length; i++) {
            var activity = activities[i];
            var membersWithSomeProductivity = this.members.filter(function(person) {
                return person.productivity[activity] > 0;
            });
            membersWithSomeProductivity.sort(function(a, b) {
                return b.productivity[activity] - a.productivity[activity];
            });
            membersGroupedAndSorted.push(membersWithSomeProductivity);
        }
        var personWithHighestSkill = null;
        do {
            personWithHighestSkill = null;
            var skillGroupIndex = null;
            membersGroupedAndSorted.forEach(function(skillGroup, index) {
                if (skillGroup.length == 0) return;
                var personFromGroup = skillGroup[0];
                var activity = activities[index];
                if (personWithHighestSkill == null) {
                    personWithHighestSkill = personFromGroup;
                    skillGroupIndex = index;
                } else {
                    if (personFromGroup.productivity[activity] >= personWithHighestSkill.productivity[activities[skillGroupIndex]]) {
                        personWithHighestSkill = personFromGroup;
                        skillGroupIndex = index;
                    }
                }
            });
            if (personWithHighestSkill) {
                this.membersSortedBySkill.push({
                    person: personWithHighestSkill,
                    activity: activities[skillGroupIndex],
                    activityIndex: skillGroupIndex
                });
                membersGroupedAndSorted[skillGroupIndex].shift();
            }
        } while (personWithHighestSkill != null);
    };
    this.updateTeam = function(newConfig, path, oldConfig) {
        if (!equalProductivities(newConfig, oldConfig)) {
            this.recreateTeam(newConfig);
        } else {
            this.updateTeamNamesAndCount(newConfig);
        }
    };
    function equalProductivities(config1, config2) {
        if (config1.length != config2.length) return false;
        return config1.every(function(memberType, index) {
            var keys = Object.keys(memberType.productivity);
            return keys.every(function(key) {
                return memberType.productivity[key] == config2[index].productivity[key];
            });
        });
    }
    this.configuration.onChange("team", this.updateTeam.bind(this));
    this.initTeam = function() {
        this.recreateTeam(this.configuration.get("team"));
    };
}

function Value(start, durationInDays, valuePerDay) {
    this.start = start;
    this.end = this.start + durationInDays * 8 * 60;
    this.valuePerDay = valuePerDay;
    this.task = null;
    this.costOfDelay = function(now, avgLeadTime) {
        var effort = 0;
        if (this.task.column.isFirstColumn()) {
            effort = avgLeadTime * 8 * 60 || this.task.getRemainingWork();
        } else {
            effort = this.task.getRemainingWork();
        }
        if (now + effort > this.start && now + effort < this.end) {
            return valuePerDay;
        }
        return 0;
    };
    this.remainingValue = function(now) {
        return Math.max(0, Math.floor((this.end - Math.max(now, this.start)) / 8)) * this.valuePerDay;
    };
    this.currentDailyValue = function(now) {
        if (now > this.start && now < this.end) {
            return valuePerDay;
        }
        return 0;
    };
    this.totalValue = function() {
        return Math.floor((this.end - this.start) / 8) * this.valuePerDay;
    };
}

var cache = new Cache();

var hookSelector = "";

function $$(selector, useCache) {
    if (useCache == undefined || useCache) {
        return cache.get(hookSelector + " " + selector);
    }
    return $(hookSelector + " " + selector);
}

function Cache() {
    this.cache = {};
    this.get = function(query) {
        var value = this.cache[query];
        if (value) return value;
        var jquery = $(query);
        this.cache[query] = jquery;
        return jquery;
    };
    this.put = function(query, value) {
        this.cache[query] = value;
    };
}

function Controls(simulation, gui) {
    this.simulation = simulation;
    this.gui = gui;
    this.adjustTempo = function(sliderValue) {
        this.simulation.hourLengthInSeconds = 100 / sliderValue;
        if (this.simulation.hourLengthInSeconds < .3) {
            if (this.gui.animate) {
                this.turnOffAnimations();
            }
            this.gui.animate = false;
        } else {
            if (!this.gui.animate) {
                this.turnOnAnimations();
            }
            this.gui.animate = true;
        }
    };
    $$(".timescale").slider({
        min: 50,
        max: 1e5,
        scale: "logarithmic",
        step: 5,
        value: 100,
        tooltip: "hide"
    }).on("slide", function(event) {
        this.adjustTempo(event.value);
    }.bind(this)).on("slideStop", function(event) {
        this.adjustTempo(event.value);
        ga("send", {
            hitType: "event",
            eventCategory: "Control",
            eventAction: "speed",
            eventLabel: "Speed Changed",
            eventValue: simulation.hourLengthInSeconds
        });
    }.bind(this));
    this.turnOffAnimations = function() {
        $$(".task").removeClass("task-animation");
    };
    this.turnOnAnimations = function() {
        $$(".task").addClass("task-animation");
    };
    $$(".stop").click(function() {
        this.gui.stop();
        ga("send", {
            hitType: "event",
            eventCategory: "Control",
            eventAction: "stop",
            eventLabel: "Stopped"
        });
    }.bind(this));
    $$(".pause").click(function() {
        this.gui.pause();
    }.bind(this));
    $$(".play").click(function() {
        this.gui.play();
    }.bind(this));
}

var commonDiagramProperties = {
    backgroundColor: null,
    zoomEnabled: true,
    zoomType: "x",
    axisY: {
        minimum: 0
    },
    axisY2: {
        minimum: 0
    },
    axisX: {
        minimum: 0
    },
    toolTip: {
        shared: "true"
    },
    legend: {
        horizontalAlign: "left",
        verticalAlign: "top",
        fontSize: 15,
        dockInsidePlotArea: true
    }
};

function DiagramCFD(simulation) {
    this.simulation = simulation;
    $$(".simulation-cfd").CanvasJSChart($.extend(true, {}, commonDiagramProperties, {
        toolTip: {
            contentFormatter: function(e) {
                var content = "Day: <strong>" + (e.entries[0].dataPoint.x + 1) + "</strong><br/>";
                for (var i = e.entries.length - 1; i >= 0; i--) {
                    content += e.entries[i].dataSeries.name + ": <strong>" + e.entries[i].dataPoint.y + "</strong><br/>";
                }
                return content;
            }
        },
        axisX: {
            labelFormatter: function(e) {
                return e.value + 1;
            }
        },
        axisY: {
            includeZero: false
        },
        rangeChanged: function(e) {
            var indexOfLowestElement = Math.floor(e.axisX.viewportMinimum);
            e.chart.options.axisY.minimum = e.chart.options.data[0].dataPoints[indexOfLowestElement].y;
            e.chart.render();
        },
        data: []
    }));
    $$(".simulation-cfd-tab").bind("isVisible", function() {
        this.updateConfiguration();
        this.update();
    }.bind(this));
    var colors = [ "silver", "mediumaquamarine", "lightskyblue", "lightpink", "lightgray", "lightcoral", "lightblue", "burlywood", "antiquewhite" ];
    this.updateConfiguration = function() {
        var groups = [];
        var group = [];
        var checkboxes = $$(".simulation-cfd-settings input[type='checkbox']", false);
        for (var i = 0; i < checkboxes.length; i++) {
            var checkbox = checkboxes[i];
            var checked = checkbox.checked;
            if (checked) {
                group = [];
                groups.push(group);
            }
            group.push([ checkbox.parentElement, this.simulation.board.columns[i] ]);
        }
        for (var i = 0; i < groups.length; i++) {
            for (var j = 0; j < groups[i].length; j++) {
                $(groups[i][j][0]).css("backgroundColor", colors[i]);
            }
        }
        var model = [];
        for (var i = 0; i < groups.length; i++) {
            var columnsToSum = [];
            var name = "group " + i;
            var fromActiveColumn = false;
            var fromColumn = false;
            var fromCoumnsActive = [];
            for (var j = 0; j < groups[i].length; j++) {
                var column = groups[i][j][1];
                columnsToSum.push(column);
                if (!fromColumn) {
                    name = column.label;
                    fromColumn = true;
                }
                if (!fromActiveColumn && !column.isQueue() && fromCoumnsActive.length == 0) {
                    name = column.label;
                    fromActiveColumn = true;
                }
                if (!column.isQueue()) {
                    fromCoumnsActive.push(column);
                }
                if (fromCoumnsActive.length > 1) {
                    name = "";
                    for (var k = 0; k < fromCoumnsActive.length; k++) {
                        name += fromCoumnsActive[k].label + " ";
                    }
                }
            }
            model[groups.length - 1 - i] = {
                type: "stackedArea",
                dataPoints: [],
                name: name.trim(),
                showInLegend: true,
                color: colors[i],
                columnsToSum: columnsToSum
            };
        }
        $$(".simulation-cfd").CanvasJSChart().options.data = model;
        this.lastUpdatedDay = -1;
        this.update();
    };
    this.lastUpdatedDay = 0;
    this.update = function() {
        var time = this.simulation.time;
        var stats = this.simulation.stats;
        var tab = $$(".simulation-cfd-tab:visible", false);
        if (tab.length == 0) {
            return;
        }
        var currentDay = Math.floor(time / (60 * 8));
        if (currentDay <= this.lastUpdatedDay) return;
        this.lastUpdatedDay = currentDay;
        var model = $$(".simulation-cfd").CanvasJSChart().options.data;
        for (var i = 0; i < model.length; i++) {
            var columnsToSum = model[i].columnsToSum;
            for (var j = model[i].dataPoints.length; j < stats.cfdData[columnsToSum[0].name].length; j++) {
                var sum = 0;
                for (var k = 0; k < columnsToSum.length; k++) {
                    sum += stats.cfdData[columnsToSum[k].name][j].y;
                }
                model[i].dataPoints[j] = {
                    x: stats.cfdData[columnsToSum[0].name].x,
                    y: sum
                };
            }
        }
        $$(".simulation-cfd").CanvasJSChart().render();
    };
    this.redraw = function() {
        this.lastUpdatedDay = -1;
        this.updateConfiguration();
        this.update();
    };
    this.renderCheckboxes = function() {
        $$(".simulation-cfd-settings-checkboxes").empty();
        var html = "";
        var previousParent = null;
        for (var i = 0; i < this.simulation.board.columns.length; i++) {
            var column = this.simulation.board.columns[i];
            html += "<div><input type='checkbox' ";
            if (column.index == 0) {
                html += "disabled checked";
            } else if (!column.parent || column.parent != previousParent) {
                previousParent = column.parent;
                html += "checked";
            }
            html += "/> " + column.label + "</div>";
        }
        $$(".simulation-cfd-settings-checkboxes").append(html);
        $$(".simulation-cfd-settings-checkboxes input[type='checkbox']").change(this.updateConfiguration.bind(this));
        $$(".simulation-cfd-settings-checkboxes div:not(:first-child)").click(function(event) {
            var checkbox = $(event.target).find("input[type='checkbox']")[0];
            if (!checkbox) return;
            checkbox.checked = !checkbox.checked;
            this.updateConfiguration();
        }.bind(this));
    };
}

function DiagramCOD(simulation) {
    this.simulation = simulation;
    $$(".simulation-cod-tab").CanvasJSChart($.extend(true, {}, commonDiagramProperties, {
        axisX: {
            labelFormatter: function(e) {
                if (e.value % 8 == 0) return e.value / 8 + 1;
                return "";
            }
        },
        toolTip: {
            contentFormatter: function(e) {
                var content = "Day: <strong>" + Math.floor(e.entries[0].dataPoint.x / 8 + 1) + "</strong><br/>";
                for (var i = 0; i < e.entries.length; i++) {
                    if (!isNaN(e.entries[i].dataPoint.y)) content += e.entries[i].dataSeries.name + ": <strong>" + e.entries[i].dataPoint.y.toFixed(1) + "</strong><br/>";
                }
                return content;
            }
        },
        data: [ {
            type: "line",
            name: "Cost Of Delay/d",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "Value Delivered/d",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "Value Dropped/d",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "WIP",
            dataPoints: [],
            showInLegend: true,
            axisYType: "secondary"
        } ]
    }));
    this.lastUpdatedDay = 0;
    this.update = function(recalculate) {
        var time = this.simulation.time;
        var stats = this.simulation.stats;
        var tab = $$(".simulation-cod-tab" + (recalculate ? "" : ":visible"), false);
        if (tab.length == 0) {
            return;
        }
        var currentDay = Math.floor(time / (60 * 8));
        if (currentDay <= this.lastUpdatedDay) {
            tab.CanvasJSChart().render();
            return;
        }
        this.lastUpdatedDay = currentDay;
        var diagramData = tab.CanvasJSChart().options.data;
        diagramData[0].dataPoints = stats.costOfDelay.getAvgHistory();
        diagramData[1].dataPoints = stats.valueDelivered.getAvgHistory();
        diagramData[2].dataPoints = stats.valueDropped.getAvgHistory();
        if (recalculate) diagramData[3].dataPoints = [];
        var wipHistory = stats.wip.getAvgHistory();
        for (var i = diagramData[3].dataPoints.length * 8; i < wipHistory.length; i += 8) {
            diagramData[3].dataPoints.push(wipHistory[i]);
        }
        tab.CanvasJSChart().render();
    };
    this.redraw = function(force) {
        this.lastUpdatedDay = -1;
        this.update(force);
    };
    $$(".simulation-cod-tab").bind("isVisible", this.update.bind(this));
}

function DiagramLittles(simulation) {
    this.simulation = simulation;
    $$(".simulation-littles-tab").CanvasJSChart($.extend(true, {}, commonDiagramProperties, {
        axisX: {
            labelFormatter: function(e) {
                return "D:" + (Math.floor(e.value / 8) + 1) + " h:" + Math.floor(e.value % 8 + 9);
            }
        },
        axisY2: {
            maximum: 100
        },
        toolTip: {
            contentFormatter: function(e) {
                var content = "Day: <strong>" + Math.floor(e.entries[0].dataPoint.x / 8 + 1) + "</strong>, hour: <strong>" + (e.entries[0].dataPoint.x % 8 + 9) + "</strong><br/>";
                for (var i = 0; i < e.entries.length; i++) {
                    if (!isNaN(e.entries[i].dataPoint.y)) content += e.entries[i].dataSeries.name + ": <strong>" + e.entries[i].dataPoint.y.toFixed(1) + "</strong><br/>";
                }
                return content;
            }
        },
        data: [ {
            type: "line",
            name: "WIP",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "Throughput",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "Lead Time",
            dataPoints: [],
            showInLegend: true
        }, {
            type: "line",
            name: "Flow Efficiency",
            dataPoints: [],
            showInLegend: true,
            axisYType: "secondary"
        }, {
            type: "line",
            name: "Capacity Utilisation",
            dataPoints: [],
            showInLegend: true,
            axisYType: "secondary"
        } ]
    }));
    this.lastUpdatedDay = 0;
    this.update = function() {
        var time = this.simulation.time;
        var stats = this.simulation.stats;
        var tab = $$(".simulation-littles-tab:visible", false);
        if (tab.length == 0) {
            return;
        }
        var currentDay = Math.floor(time / (60 * 8));
        if (currentDay <= this.lastUpdatedDay) return;
        this.lastUpdatedDay = currentDay;
        var diagramData = tab.CanvasJSChart().options.data;
        diagramData[0].dataPoints = stats.wip.getAvgHistory();
        diagramData[1].dataPoints = stats.throughput.getAvgHistory();
        diagramData[2].dataPoints = stats.leadTime.getAvgHistory();
        diagramData[3].dataPoints = stats.touchTimePercent.getAvgHistory();
        diagramData[4].dataPoints = stats.capacityUtilisation.getAvgHistory();
        tab.CanvasJSChart().render();
    };
    this.redraw = function() {
        this.lastUpdatedDay = -1;
        this.update();
    };
    $$(".simulation-littles-tab").bind("isVisible", this.update.bind(this));
}

function DiagramScatterplot(simulation) {
    this.simulation = simulation;
    $$(".simulation-scatterplot-tab").CanvasJSChart($.extend(true, {}, commonDiagramProperties, {
        axisX: {
            labelFormatter: function(e) {
                return "D:" + (Math.floor(e.value / 60 / 8) + 1) + " h:" + Math.floor(e.value / 60 % 8 + 9);
            }
        },
        toolTip: {
            contentFormatter: function(e) {
                var value = e.entries[0].dataPoint.x;
                var content = "Day: <strong>" + (Math.floor(value / 60 / 8) + 1) + ", hour:" + Math.floor(value / 60 % 8 + 9) + "</strong><br/>";
                for (var i = 0; i < e.entries.length; i++) {
                    if (!isNaN(e.entries[i].dataPoint.y)) content += e.entries[i].dataSeries.name + ": <strong>" + e.entries[i].dataPoint.y.toFixed(1) + "</strong><br/>";
                }
                return content;
            }
        },
        data: [ {
            type: "scatter",
            name: "Lead Time",
            dataPoints: [],
            showInLegend: false,
            markerSize: 4
        }, {
            type: "line",
            name: "Percentile",
            dataPoints: [],
            showInLegend: false,
            axisYType: "secondary"
        } ]
    }));
    this.lastUpdatedDay = 0;
    this.update = function(recalculate) {
        var time = this.simulation.time;
        var stats = this.simulation.stats;
        var tab = $$(".simulation-scatterplot-tab:visible", false);
        if (tab.length == 0) {
            return;
        }
        var currentDay = Math.floor(time / (60 * 8));
        if (currentDay <= this.lastUpdatedDay) return;
        this.lastUpdatedDay = currentDay;
        var diagramData = tab.CanvasJSChart().options.data;
        diagramData[0].dataPoints = stats.leadTimesHistory;
        if (recalculate) diagramData[1].dataPoints = [];
        tab.CanvasJSChart().render();
    };
    this.redraw = function() {
        this.lastUpdatedDay = -1;
        this.update();
    };
    $$(".simulation-scatterplot-tab").bind("isVisible", this.update.bind(this));
}

function GUI(hookSelectorParam, simulation, configuration) {
    hookSelector = hookSelectorParam;
    this.configuration = configuration;
    this.simulation = simulation;
    this.fps = 4;
    this.lastUpdated = Date.now();
    this.animate = true;
    var controls = new Controls(this.simulation, this);
    this.cfdDiagram = new DiagramCFD(this.simulation);
    this.littlesDiagram = new DiagramLittles(this.simulation);
    this.codDiagram = new DiagramCOD(this.simulation);
    this.scatterplotDiagram = new DiagramScatterplot(this.simulation);
    this.colors = [ "blue", "chocolate", "darkturquoise", "royalblue", "hotpink", "green", "goldenrod", "aqua", "cadetblue" ];
    this.rendered = false;
    this.init = function() {
        if (!this.rendered) {
            this.renderBoard();
            this.cfdDiagram.renderCheckboxes();
            this.renderHeadcountConfigInputs();
            this.renderTaskStrategies();
            this.renderBoardConfig();
            this.rendered = true;
        }
        this.bind();
        this.registerConfigurationOnChangeListeners();
        this.update(this.simulation.board, this.simulation.stats, true);
        this.initialiseBacklogStrategies();
    };
    this.renderBoardConfig = function() {
        $$(".board-config tbody").sortable({
            items: ".sortit",
            cursor: "pointer"
        });
        var columns = this.simulation.board.columns;
        var html = "";
        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            html += i == 0 || i == columns.length - 1 ? "<tr><td>" : "<tr class='sortit'><td>";
            html += (i == 0 || i == columns.length - 1 ? "" : "<span class='glyphicon glyphicon-menu-hamburger' aria-hidden='true'></span>") + "</td><td>";
            html += i == 0 || i == columns.length - 1 ? "" : "<input data-type='group' type='text' placeholder='Group name' value='" + (column.parent ? column.parent.boardLabel : "") + "'/>";
            html += "</td><td><input data-type='label' type='text' placeholder='Column name' value='" + column.boardLabel + "'/></td>";
            html += "<td><input data-type='cfdLabel' type='text' placeholder='Long name' value='" + column.label + "'/></td><td>";
            html += i == 0 || i == columns.length - 1 ? "" : "<input data-type='queue' type='checkbox' " + (column.isQueue() ? "checked" : "") + "/>";
            html += "</td><td>" + (i == 0 || i == columns.length - 1 ? "" : "<span class='glyphicon glyphicon-remove board-column-remove' aria-hidden='true'></span>");
            html += "</td></tr>";
        }
        $$(".board-config tr").after(html);
        var removeListener = function() {
            $(this).parent().parent().remove();
        };
        $$(".board-column-remove").click(removeListener);
        $$(".board-config-add-column").click(function() {
            var html = "<tr class='sortit'><td><span class='glyphicon glyphicon-menu-hamburger' aria-hidden='true'></span></td><td><input data-type='group' type='text' placeholder='Group name'></td><td><input data-type='label' type='text' placeholder='Column name'></td><td><input data-type='cfdLabel' type='text' placeholder='Long name'></td><td><input data-type='queue' type='checkbox'></td><td><span class='glyphicon glyphicon-remove board-column-remove' aria-hidden='true'></span></td></tr>";
            var rows = $$(".board-config tr", false);
            var newRow = $(html);
            $(rows[rows.length - 1]).before(newRow);
            newRow.find(".board-column-remove").click(removeListener);
        });
        $$(".board-config-save").click(function() {
            var newConfig = [];
            var groups = [];
            var groupIndex = 0;
            $$(".board-config tr:visible", false).each(function(index, row) {
                if (index == 0) return;
                $row = $(row);
                var column = {};
                newConfig.push(column);
                $row.find("input").each(function(index, input) {
                    var $input = $(input);
                    var value;
                    if (input.type == "checkbox") {
                        value = input.checked;
                    } else {
                        value = input.value;
                    }
                    var type = $input.data("type");
                    if (type == "group" && value != "") {
                        if (groups.length == 0 || groups[groups.length - 1].label != value) {
                            var group = {};
                            group["label"] = value;
                            group.children = [];
                            group.name = "colgrp" + groupIndex;
                            groupIndex++;
                            groups.push(group);
                        }
                        var group = groups[groups.length - 1];
                        group.children.push(column);
                    }
                    column[type] = value;
                });
                if (!column.cfdLabel || column.cfdLabel == "") {
                    column.cfdLabel = (column.group ? column.group + " " : "") + column.label;
                }
                delete column["group"];
            });
            newConfig[newConfig.length - 1]["ignoreLimit"] = true;
            newConfig[newConfig.length - 1]["queue"] = true;
            newConfig[0]["queue"] = true;
            for (var i = 0; i < newConfig.length; i++) {
                newConfig[i].name = "col" + i;
            }
            for (var i = 0; i < groups.length; i++) {
                var group = groups[i];
                var childrenNames = [];
                for (var j = 0; j < group.children.length; j++) {
                    childrenNames.push(group.children[j].name);
                }
                group.children = childrenNames;
                newConfig.push(group);
            }
            this.configuration.pauseListeners();
            this.configuration.set("columns.definitions", newConfig);
            var columnsWithUpdatedLimits = [];
            this.configuration.set("columns.limits", {});
            for (var i = 0; i < groups.length; i++) {
                var group = groups[i];
                this.configuration.set("columns.limits." + group.name, 3);
                columnsWithUpdatedLimits.push(group.name);
                for (var j = 0; j < group.children.length; j++) {
                    var columnName = group.children[j];
                    this.configuration.set("columns.limits." + columnName, null);
                    columnsWithUpdatedLimits.push(columnName);
                }
            }
            for (var i = 1; i < newConfig.length; i++) {
                var column = newConfig[i];
                if (columnsWithUpdatedLimits.indexOf(column.name) == -1) {
                    this.configuration.set("columns.limits." + column.name, 3);
                }
            }
            var clearColsFrom = function(obj) {
                var keys = Object.keys(obj);
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i].startsWith("col")) {
                        delete obj[keys[i]];
                    }
                }
            };
            var team = this.configuration.get("team");
            var activities = configuration.getActiveStates();
            team.forEach(function(memberType) {
                var keys = Object.keys(memberType.productivity);
                keys.forEach(function(key) {
                    if (activities.indexOf(key) == -1) {
                        delete memberType.productivity[key];
                    }
                });
                activities.forEach(function(activity) {
                    if (memberType.productivity[activity] === undefined) {
                        memberType.productivity[activity] = 50;
                    }
                });
            });
            var constant = this.configuration.get("tasks.sizeStrategy.configs.constant");
            clearColsFrom(constant);
            var normal = this.configuration.get("tasks.sizeStrategy.configs.normal");
            clearColsFrom(normal);
            var tshirt = this.configuration.get("tasks.sizeStrategy.configs.tshirt");
            clearColsFrom(tshirt);
            var activeCount = 0;
            for (var i = 1; i < newConfig.length; i++) {
                var column = newConfig[i];
                if (column.queue === false) {
                    activeCount++;
                    constant[column.name] = 2;
                    normal[column.name] = 2;
                    normal[column.name + "-variation"] = 1;
                }
            }
            for (var i = 1; i < newConfig.length && activeCount > 0; i++) {
                var column = newConfig[i];
                if (!column.queue) {
                    tshirt[column.name] = 100 / activeCount;
                }
            }
            this.updateURL();
            window.top.location.reload();
        }.bind(this));
    };
    this.renderBoard = function() {
        $$(".board tr").empty();
        var columns = this.simulation.board.columns;
        var firstRowHeader = [];
        var secondRowHeader = [];
        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            if (column.parent) {
                if (firstRowHeader.indexOf(column.parent) < 0) {
                    firstRowHeader.push(column.parent);
                }
                secondRowHeader.push(column);
            } else {
                firstRowHeader.push(column);
            }
        }
        for (var i = 0; i < firstRowHeader.length; i++) {
            var column = firstRowHeader[i];
            var html = "<th ";
            if (column.children.length > 0) {
                html += "colspan='" + column.children.length + "' ";
            } else {
                html += "rowspan='2' ";
            }
            html += ">" + column.boardLabel;
            if (!column.ignoreLimit) {
                html += " <input type='text' data-model='columns.limits." + column.name + "'/>";
            }
            html += "</th>";
            $$(".board tr:nth-child(1)").append(html);
        }
        for (var i = 0; i < secondRowHeader.length; i++) {
            var column = secondRowHeader[i];
            var html = "<th>";
            html += column.boardLabel;
            if (!column.ignoreLimit) {
                html += " <input type='text' data-model='columns.limits." + column.name + "'/>";
            }
            html += "</th>";
            $$(".board tr:nth-child(2)").append(html);
        }
        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            var html = "<td class='" + column.name + "' ></td>";
            $$(".board tr:nth-child(3)").append(html);
        }
    };
    this.renderHeadcountConfigInputs = function() {
        var columns = this.simulation.board.columns;
        var activeColumns = [];
        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            if (!column.isQueue()) {
                activeColumns.push(column);
            }
        }
        var html = "<tr><th></th><th>Name</th><th>Headcount</th>";
        for (var i = 0; i < activeColumns.length; i++) {
            var column = activeColumns[i];
            html += "<th>" + column.label + "</th>";
        }
        html += "<th></th></tr>";
        var team = this.configuration.get("team");
        for (var i = 0; i < team.length; i++) {
            var row = team[i];
            var color = this.colors[i % this.colors.length];
            var personSpan = "<span class='glyphicon glyphicon-user person' style='color: " + color + "'/>";
            html += "<tr><td>" + personSpan + "</td>";
            html += "<td><input type='text' value='" + row.name + "'></input></td>";
            html += "<td><input type='text' value='" + row.count + "'></input></td>";
            for (var j = 0; j < activeColumns.length; j++) {
                var column = activeColumns[j];
                html += "<td><input type='text' value='" + row.productivity[column.name] + "'></input></td>";
            }
            html += "<td><span class='glyphicon glyphicon-remove team-member-remove' aria-hidden='true'></span></td>";
            html += "</tr>";
        }
        $$(".who-works-where").append(html);
        var recolorPersonIcons = function(colors) {
            $$(".who-works-where span.person", false).each(function(index, span) {
                var color = colors[index % colors.length];
                $(span).css("color", color);
            });
        };
        var removeListener = function(event) {
            $(this).parent().parent().remove();
            recolorPersonIcons(event.data.colors);
        };
        $$(".team-member-remove").click(this, removeListener);
        $$(".team-member-add").click(function() {
            var personSpan = "<span class='glyphicon glyphicon-user person'/>";
            var html = "<tr><td>" + personSpan + "</td>";
            html += "<td><input type='text' ></input></td>";
            html += "<td><input type='text' value='1'></input></td>";
            for (var j = 0; j < activeColumns.length; j++) {
                html += "<td><input type='text' value='50'></input></td>";
            }
            html += "<td><span class='glyphicon glyphicon-remove team-member-remove' aria-hidden='true'></span></td>";
            html += "</tr>";
            var rows = $$(".who-works-where tr", false);
            var newRow = $(html);
            $(rows[rows.length - 1]).after(newRow);
            newRow.find(".team-member-remove").click(this, removeListener);
            recolorPersonIcons(this.colors);
        }.bind(this));
    };
    this.renderTaskStrategies = function() {
        var columns = this.simulation.board.columns;
        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            if (!column.isQueue()) {
                var html = "<tr data-for-option='constant'><td>" + column.label + "</td><td colspan='2'><input type='text' data-model='tasks.sizeStrategy.configs.constant." + column.name + "'/> hours</td></tr>";
                html += "<tr data-for-option='normal'><td>" + column.label + " mean:</td><td colspan='2'><input type='text' data-model='tasks.sizeStrategy.configs.normal." + column.name + "'/> hours</td></tr><tr data-for-option='normal'><td>" + column.label + " variation:</td><td colspan='2'><input type='text' data-model='tasks.sizeStrategy.configs.normal." + column.name + "-variation'/></td></tr>";
                html += "<tr data-for-option='tshirt'><td>" + column.label + "</td><td colspan='2'><input type='text' data-model='tasks.sizeStrategy.configs.tshirt." + column.name + "'/> %</td></tr>";
                $$(".task-size-strategies").append(html);
            }
        }
    };
    this.stop = function() {
        this.simulation.stop();
        this.cfdDiagram.redraw();
        this.littlesDiagram.redraw();
        this.codDiagram.redraw(true);
        this.scatterplotDiagram.redraw();
        this.update(this.simulation.board, this.simulation.stats, true);
    };
    this.pause = function() {
        this.simulation.pause();
        this.update(this.simulation.board, this.simulation.stats, true);
        ga("send", {
            hitType: "event",
            eventCategory: "Control",
            eventAction: "pause",
            eventLabel: "Paused"
        });
    };
    this.play = function() {
        this.simulation.play();
        ga("send", {
            hitType: "event",
            eventCategory: "Control",
            eventAction: "start",
            eventLabel: "Started"
        });
    };
    $$(".simulation-help").click(function() {
        window.top.location = "https://mgajdzik.com/kanban-flow-simulator/help/";
    });
    this.updateURL = function() {
        var url = "" + window.top.location;
        url = url.replace(/simulation-config=[a-zA-Z=0-9]*/, "");
        if (url.indexOf("#") == -1) url = url + "#";
        url = url + "simulation-config=";
        url = url + btoa(JSON.stringify(this.configuration.data));
        window.top.location = url;
    };
    this.updateComponentsDependingOnRunningAverage = function() {
        this.littlesDiagram.redraw();
        this.littlesDiagram.redraw(true);
        this.updateStats();
    };
    this.registerConfigurationOnChangeListeners = function() {
        this.configuration.afterChange("stats.noOfDaysForMovingAverage", this.updateComponentsDependingOnRunningAverage.bind(this));
        this.configuration.onChange("tasks.arrivalStrategy.current", this.arrivalStrategyChanged.bind(this));
        this.configuration.onChange("tasks.sizeStrategy.current", this.sizeStrategyChanged.bind(this));
    };
    this.arrivalStrategyChanged = function(newValue) {
        $$(".backlog-settings-temporal [data-for-option]").hide();
        $$(".backlog-settings-temporal [data-for-option='" + newValue + "']").show();
    };
    this.sizeStrategyChanged = function(newValue) {
        $$(".backlog-settings-task-size [data-for-option]").hide();
        $$(".backlog-settings-task-size [data-for-option='" + newValue + "']").show();
    };
    this.initialiseBacklogStrategies = function() {
        this.arrivalStrategyChanged(this.configuration.get("tasks.arrivalStrategy.current"));
        this.sizeStrategyChanged(this.configuration.get("tasks.sizeStrategy.current"));
    };
    var bottomMenuSelectedTab = 0;
    $$(".bottom-menu .nav li").click(function() {
        var navElement = $(this);
        if (navElement.hasClass("active")) return;
        $$(".bottom-menu .nav li:nth-child(" + (bottomMenuSelectedTab + 1) + ")").toggleClass("active", false);
        $$(".bottom-menu>div:nth-of-type(" + (bottomMenuSelectedTab + 1) + ")").hide(0, function() {
            $(this).trigger("isHidden");
        });
        bottomMenuSelectedTab = navElement.index();
        $$(".bottom-menu .nav li:nth-child(" + (bottomMenuSelectedTab + 1) + ")").toggleClass("active", true);
        $$(".bottom-menu>div:nth-of-type(" + (bottomMenuSelectedTab + 1) + ")").show(0, function() {
            $(this).trigger("isVisible");
        });
    });
    var settingsSelectedTab = 0;
    $$(".simulation-settings-modal .modal-body .nav li").click(function() {
        var navElement = $(this);
        if (navElement.hasClass("active")) return;
        $$(".simulation-settings-modal .modal-body .nav li:nth-child(" + (settingsSelectedTab + 1) + ")").toggleClass("active", false);
        $$(".simulation-settings-modal .modal-body>div:nth-of-type(" + (settingsSelectedTab + 1) + ")").hide(0, function() {
            $(this).trigger("isHidden");
        });
        settingsSelectedTab = navElement.index();
        $$(".simulation-settings-modal .modal-body .nav li:nth-child(" + (settingsSelectedTab + 1) + ")").toggleClass("active", true);
        $$(".simulation-settings-modal .modal-body>div:nth-of-type(" + (settingsSelectedTab + 1) + ")").show(0, function() {
            $(this).trigger("isVisible");
        });
    });
    $$(".bottom-menu>div:not(:nth-of-type(1))").hide();
    $$(".simulation-settings-modal .modal-body>div:not(:nth-of-type(1))").hide();
    this.settingsOpened = function() {
        this.wasRunningWhenSettingsOpened = false;
        if (this.simulation.isRunning()) {
            this.wasRunningWhenSettingsOpened = true;
            this.pause();
        }
    };
    this.settingsClosed = function() {
        this.updateTeam();
        if (this.wasRunningWhenSettingsOpened) {
            this.play();
        }
    };
    this.updateTeam = function() {
        var newTeamConfig = this.getTeamConfigurationFromInputs();
        this.configuration.set("team", newTeamConfig);
        this.updateURL();
    };
    $$(".simulation-settings-team-tab").bind("isHidden", this.updateTeam.bind(this));
    this.getTeamConfigurationFromInputs = function() {
        var activities = this.configuration.getActiveStates();
        var result = [];
        $$(".who-works-where tr:not(:first-child)", false).each(function(index, tr) {
            var memberType = {
                productivity: {}
            };
            result.push(memberType);
            $(tr).find("input").each(function(index, input) {
                switch (index) {
                  case 0:
                    memberType.name = input.value;
                    break;

                  case 1:
                    memberType.count = parseInt(input.value) || 0;
                    break;

                  default:
                    memberType.productivity[activities[index - 2]] = parseInt(input.value) || 0;
                }
            });
        });
        return result;
    };
    $$(".simulation-settings-modal").on("show.bs.modal", this.settingsOpened.bind(this));
    $$(".simulation-settings-modal").on("hide.bs.modal", this.settingsClosed.bind(this));
    this.taskDetails = null;
    function taskMouseover(event) {
        var div = $$(".task-details");
        var $taskDiv = $(event.currentTarget);
        var position = $taskDiv.position();
        var top = position.top;
        var left = position.left;
        div.css({
            position: "absolute",
            top: top,
            left: left,
            minWidth: $taskDiv.css("width")
        });
        div.show();
        var task = $taskDiv.data("taskReference");
        this.taskDetails = task;
        this.updateTaskDetails(task);
    }
    this.updateTaskDetails = function(task) {
        if (!task) return;
        var div = $$(".task-details");
        var $taskDiv = $$("." + task.id, false);
        if ($taskDiv.length == 0) {
            div.hide();
            this.taskDetails = null;
            return;
        }
        var detailsDivPosition = div.position();
        var taskDivPosition = $taskDiv.position();
        if (detailsDivPosition.top != taskDivPosition.top || detailsDivPosition.left != taskDivPosition.left) {
            div.hide();
            this.taskDetails = null;
            return;
        }
        div.find("[data-task-detail=name]").html(task.label);
        var created = "D: " + (Math.floor(task.created / 60 / 8) + 1) + ", t: " + Math.floor(task.created / 60 % 8 + 9) + ":" + (task.created % 60 < 10 ? "0" : "") + task.created % 60;
        div.find("[data-task-detail=since]").html(created);
        var activities = this.configuration.getActiveStates();
        var work = div.find(".task-details-work");
        work.html("");
        activities.forEach(function(activity) {
            work.append("<p>" + this.simulation.board.getColumnByName(activity).label + ": <span>" + Math.max(0, task.size[activity]).toFixed(0) + "/" + task.originalSize[activity].toFixed(0)) + "</span></p>";
        }.bind(this));
        var people = div.find(".task-details-people");
        people.html(task.peopleAssigned.length > 0 ? "<p>People assigned:</p>" : "");
        task.peopleAssigned.forEach(function(person) {
            people.append('<p><span class="glyphicon glyphicon-user person" style="color: ' + this.colors[person.typeIndex] + '"></span> ' + person.name + (person.tasksWorkingOn.length > 1 ? " (" + (100 / person.tasksWorkingOn.length).toFixed(0) + "%)" : "") + "</p>");
        }.bind(this));
    };
    function taskMouseleave() {
        var div = $$(".task-details");
        this.taskDetails = null;
        div.hide();
    }
    this.update = function(board, stats, force) {
        var now = Date.now();
        if (!force && now - this.lastUpdated < 1e3 / this.fps) return;
        this.lastUpdated = now;
        this.updateTime();
        this.updateStats();
        this.updateBoard();
        this.cfdDiagram.update();
        this.littlesDiagram.update();
        this.codDiagram.update(force);
        this.scatterplotDiagram.update(force);
        this.updateTaskDetails(this.taskDetails);
    };
    this.updateTime = function() {
        function pad(n) {
            return n < 10 ? "0" + n : n;
        }
        var time = this.simulation.time;
        $$(".day").text(pad(Math.floor(time / (8 * 60)) + 1));
        $$(".hour").text(pad(Math.floor(time / 60) % 8 + 9) + ":" + pad(time % 60));
    };
    this.updateStats = function() {
        var stats = this.simulation.stats;
        var wipAvg = stats.wip.getAvg();
        var leadTimeAvg = stats.leadTime.getAvg();
        $$(".stats-wip").text(wipAvg ? wipAvg.toFixed(1) : "-");
        $$(".stats-throughput").text(stats.throughput.getAvg() ? stats.throughput.getAvg().toFixed(1) : "-");
        $$(".stats-lead-time").text(leadTimeAvg ? leadTimeAvg.toFixed(1) : "-");
        $$(".stats-wip-lead-time").text(wipAvg && leadTimeAvg ? (wipAvg / leadTimeAvg).toFixed(1) : "-");
        $$(".stats-utilisation").text(stats.capacityUtilisation.getAvg() ? stats.capacityUtilisation.getAvg().toFixed(1) : "-");
    };
    this.updateBoard = function() {
        var board = this.simulation.board;
        var allVisualColumns = $($$(".tasks td", false).get().reverse()).toArray();
        allVisualColumns.forEach(function(columnVisual) {
            var columnVisualId = columnVisual.className;
            columnVisual = $(columnVisual);
            columnVisual.children().each(function(index, taskElement) {
                var $task = $(taskElement);
                var task = $task.data("taskReference");
                if (task.column) {
                    $task.find(".progress-bar").width((100 * task.size[task.column.name] / task.originalSize[task.column.name]).toFixed(1) + "%");
                    $task.find(".task-status").html(this.createStatusSpan(task.peopleAssigned));
                }
                if (!board.tasks[task.id]) {
                    $task.remove();
                } else if (task.column && task.column.name != columnVisualId) {
                    $task.remove();
                    var newTaskInstance = this.createTaskDiv(task);
                    $$(".tasks td." + task.column.name, false).append(newTaskInstance);
                    $task = newTaskInstance;
                }
            }.bind(this));
        }.bind(this));
        for (var key in board.tasks) {
            if (!board.tasks.hasOwnProperty(key)) {
                continue;
            }
            var task = board.tasks[key];
            if ($$("." + task.id, false).length == 0) {
                var newTask = this.createTaskDiv(task);
                $$(".tasks td." + task.column.name, false).append(newTask);
            }
        }
    };
    this.createTaskDiv = function(task) {
        var html = "<div class='task " + task.id + (this.animate ? " task-animation" : "") + "'>" + task.label + " <div class='task-status'>" + this.createStatusSpan(task.peopleAssigned) + "</div><div class='progress'><div class='progress-bar progress-bar-info' style='width:100%'/></div></div>";
        return $(html).data("taskReference", task).mouseover(taskMouseover.bind(this)).mouseleave(taskMouseleave);
    };
    this.createStatusSpan = function(peopleWorkingOn) {
        if (peopleWorkingOn.length == 0) {
            return "<span class='glyphicon glyphicon-hourglass waiting'/>";
        }
        var html = "";
        peopleWorkingOn.forEach(function(person) {
            var color = this.colors[person.typeIndex % this.colors.length];
            html += "<span class='glyphicon glyphicon-user person' style='color: " + color + "'/>";
        }.bind(this));
        return html;
    };
    this.bind = function() {
        var bindedElements = $$("[data-model]:not([data-binded])", false);
        for (var i = 0; i < bindedElements.length; i++) {
            var $input = $(bindedElements[i]);
            var key = $input.data("model");
            if (bindedElements[i].type == "checkbox") {
                if (this.configuration.get(key)) {
                    $input.attr("checked", "checked");
                } else {
                    $input.removeAttr("checked");
                }
            } else {
                $input.val(this.configuration.get(key));
            }
            $input.change(function(event) {
                var newValue = event.target.type == "checkbox" ? event.target.checked : event.target.value;
                if (typeof newValue == "string" && !isNaN(parseFloat(newValue))) {
                    newValue = parseFloat(newValue);
                }
                var property = $(event.target).data("model");
                this.configuration.set(property, newValue);
                this.updateURL();
                ga("send", {
                    hitType: "event",
                    eventCategory: "Configuration change",
                    eventAction: property
                });
            }.bind(this));
            $input.data("binded", true);
        }
    };
}