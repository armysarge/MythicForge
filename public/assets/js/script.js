import DiceBox from "/assets/plugins/dice-box/dist/dice-box.es.js";
import AdvancedRoller from "/assets/plugins/dice-ui/src/advancedRoller/advancedRoller.js";

/**
 * @file script.js
 * @fileoverview The main script file for Mythic Forge application, handling monster data management,
 * window creation, and UI interactions.
 *
 * @requires jQuery
 * @requires jQuery UI
 * @requires Renderer
 * @requires Parser
 * @requires DataLoader
 * @requires UrlUtil
 *
 * @global {boolean} SRDonly - Flag to determine if only SRD content should be displayed
 * @global {Array} AllMonsters - Array of all monster data loaded from 5etools
 * @global {Array} AllSpells - Array of all spell data loaded from 5etools
 * @global {DiceBox} diceBox - Instance of the DiceBox class for dice rolling
 * @global {MythicForgeWindow} RollboxWindow - Instance of the MythicForgeWindow class for the roll box
 *
 * @author Shaun Scholtz
 * @version 0.0.1
 * @license AGPLv3
 *
 * @example
 * // Create a new window
 * const window = new MythicForgeWindow(WinManager);
 * window.createWindow('Title', 'Content');
 *
 * // Display monster stat block
 * createMonsterStatBlock('Goblin', 'MM');
 */
var AllMonsters = [];
var AllSpells = [];
var AllItems = [];
var SRDonly = false;
let diceBox, RollboxWindow;
var WinManager = new MythicForgeWindowManager();

//Override the dice roller to use the dice box
Renderer.dice.bindOnclickListener = function(ele) {
    ele.addEventListener("click", (evt) => {
        let eleDice = null;
        if (evt.target.hasAttribute("data-packed-dice")) {
            eleDice = evt.target;
        } else if (evt.target.parentElement && evt.target.parentElement.hasAttribute("data-packed-dice")) {
            eleDice = evt.target.parentElement;
        }

        if (!eleDice) return;

        evt.preventDefault();
        evt.stopImmediatePropagation();

        const packed = JSON.parse(eleDice.getAttribute("data-packed-dice"));

        if (packed.rollable === false) return;
        console.log(packed);

        var toRoll = packed.toRoll.replace(/\+0/g, "").replace(/-0/g, "");
        const rollType = (packed.subType) ? packed.subType : "";

        if (packed.prompt) {
            var dicePopupHMTL = `<center><div class="dicePopup">`;

            //loop each object in the options object
            Object.keys(packed.prompt.options).forEach((key, i2) => {
                var value = packed.prompt.options[key];
                if (value != '')
                    dicePopupHMTL += `<button class="diceOption" title='${packed.toRoll} + ${value}' data-packed-dice='{"type":"${packed.type}","rollable":${packed.rollable},"toRoll":"${packed.toRoll} + ${value}","displayText":"${value}","subType":"${packed.subType}"}'>Level ${key}</button>`;
            });

            dicePopupHMTL += `</div></center>`;
            var dicePopup = new MythicForgeWindow(WinManager);
            dicePopup.createWindow(packed.prompt.entry, dicePopupHMTL,{class: "dicePopupWindow"});
            dicePopup.el.fadeIn();
        } else {


            switch (rollType) {
                case "damage":
                    //if SHIFT click, roll critical
                    if (evt.shiftKey) {
                        toRoll = toRoll + "+" + toRoll;
                    } else if (evt.ctrlKey) {
                        toRoll = "floor(" + toRoll + "/2)";
                    }
                    break;
                case "d20":
                    //if SHIFT click, roll with advantage
                    if (evt.shiftKey) {
                        toRoll = toRoll.replace("1d20", "2d20kh1");
                    } else if (evt.ctrlKey) {
                        toRoll = toRoll.replace("1d20", "2d20kl1");
                    }
                    break;
                default:
                    //if SHIFTor CTRL click, roll twice
                    if (evt.shiftKey || evt.ctrlKey)
                        toRoll = toRoll + "+" + toRoll
            }

            RollboxWindow.show();

            //TODO: Support for critical rolls
            //TODO: Support for advantage/disadvantage rolls
            diceBox.clear();
            $(".diceResult").hide();
            if (typeof packed.successMax != "undefined"){
                var thressHold = packed.successThresh;
                if (typeof thressHold == "undefined") thressHold = 0;
                toRoll = ""+toRoll+">"+(packed.successMax-thressHold);
            }

            $(".adv-roller--notation").val(toRoll);

            diceBox.onRollComplete = (rollResult) => {
                console.log("roll results callback", rollResult)
                $(".adv-roller--notation").data("subType", rollType);
                if (typeof packed.successMax != "undefined"){
                    var thressHold = packed.successThresh;
                    if (typeof thressHold == "undefined") thressHold = 0;
                    if (rollResult[0].value > packed.successMax-thressHold){
                        $(".adv-roller--notation").data("subType", "<span "+(packed.isColorSuccessFail?"style='color:green'":"")+">"+packed.chanceSuccessText+"</span>");
                    }else{
                        $(".adv-roller--notation").data("subType", "<span "+(packed.isColorSuccessFail?"style='color:red'":"")+">"+packed.chanceFailureText+"</span>");
                    }
                    toRoll = ""+toRoll+">"+(packed.successMax-thressHold);
                }
                Roller.handleResults(rollResult);
            };
            Roller.onSubmit(Roller.DRP.parseNotation(toRoll));

            if ($(eleDice).hasClass("diceOption"))
                $(eleDice).parents(".dicePopupWindow").fadeOut(function() {
                    $(this).remove();
                });

        }
    });
}

RollboxWindow = new MythicForgeWindow(WinManager);
RollboxWindow.createWindow('Roll Box', "<div class='rollWindow'></div><div class='diceResult'></div><center></center>",{class: "rollboxWindow notInitialized"});
const Roller = new AdvancedRoller({
    target: '.rollboxWindow .windowContent center',
    onSubmit: (notation) => {
        diceBox.roll(notation);
    },
    onResults: (results) => {
        console.log("Results", results);
        var subType = $(".adv-roller--notation").data("subType");
        if (typeof results.result == "undefined") results.result = results.value;
        var resultsString = "";
        if (typeof results.rolls == "undefined") {
            $.each(results.dice, function(i, dice) {
                if (typeof dice.rolls != "undefined") {
                    if (i > 0) resultsString += ", ";
                    resultsString += dice.rolls.map(roll => roll.roll).join(", ")
                }
            });
            resultsString += " = " + results.result;
        } else {
            resultsString = results.rolls.map(roll => roll.roll).join(", ") + ((results.type != "die" || subType == "damage" || (subType == "" && results.type == "die"))?" = " + results.result:"");
        }
        if (subType != "" && subType != "d20")
            resultsString += ` (${subType})`;
        $(".diceResult").html(resultsString);
        $(".diceResult").fadeIn();
        //displayRollResults.showResults(results);
    },
    onReroll: (rolls) => {
        rolls.forEach(roll => diceBox.add(roll))
    },
    onClear: () => {
        diceBox.clear();
        $(".diceResult").hide();
    }
});
RollboxWindow.el.show();

diceBox = new DiceBox(".rollboxWindow .windowContent .rollWindow", {
    assetPath: "/assets/",
    theme: "smooth",
    themeColor: "#FE3E03FF",
    scale: 9,
    gravity: 1.8,
    mass: 1.8,
    offscreen: !0
});

diceBox.init().then(() => {
    RollboxWindow.el.hide();
    RollboxWindow.el.removeClass("notInitialized");
});

// Document ready function
$(document).ready(function() {

    SRDonly = getUserSettings().srd_content == 1;

    //Load all monster data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY, 1).then(function(data) {
        AllMonsters = data;
    });

    //Load all spell data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_SPELLS, 1).then(function(data) {
        AllSpells = data;
    });

    //Load all items data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_ITEMS).then(function(data) {
        AllItems = data;
    });

    // Open and close the settings window
    $(".showSettings").on("click tap", function(evt) {
        if ($(".settingsWindow").length == 0) {
            var settingsWindow = new MythicForgeWindow(WinManager);
            settingsWindow.createWindow("Settings", `
                <div class="settingsContent">
                    <div class="settingsList">

                        <div class="mythicCheckbox" title="Only display content from the System Reference Document">
                            <input class='tgl tgl-ios' id='srd_content' value="1" ${getUserSettings().srd_content == 1 ? "checked" : ""} type='checkbox'>
                            <label class='tgl-btn' for='srd_content'>SRD Content</label>
                        </div>

                        <div class="mythicCheckbox" title="Enable or disable the AI features (Requires credentials in environment file)">
                            <input class='tgl tgl-ios' id='using_ai' value="1" ${getUserSettings().using_ai == 1 ? "checked" : ""} type='checkbox'>
                            <label class='tgl-btn' for='using_ai'>AI Features</label>
                        </div>
                    </div>
                </div>
            `,{class: "settingsWindow"});
            settingsWindow.el.fadeIn();

            $(".settingsWindow").on("change", "#srd_content", function(evt) {
                var settings = getUserSettings();
                settings.srd_content = $(this).is(":checked") ? 1 : 0;
                localStorage.setItem("userSettings", JSON.stringify(settings));
                SRDonly = settings.srd_content == 1;
            });

            $(".settingsWindow").on("change", "#using_ai", function(evt) {
                var settings = getUserSettings();
                settings.using_ai = $(this).is(":checked") ? 1 : 0;
                localStorage.setItem("userSettings", JSON.stringify(settings));
            });
        } else {
            if ($(".settingsWindow").css("display") == "block" && $(".settingsWindow").hasClass("focused")) {
                $(".settingsWindow").css("display", "none");
                return;
            } else {
                $(".settingsWindow").fadeIn();
            }
        }
    });

    //Open and close the items window
    $(".showItems").on("click tap", function(evt) {
        if ($(".itemsWindow").length == 0) {
            var itemsWindow = new MythicForgeWindow(WinManager);
            itemsWindow.createWindow("Items", `
                <div class="itemsContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchItems" placeholder="Search here">
                <table class="itemsList">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Type</th>
                            <th>Rarity</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `,{class: "itemsWindow"});

            itemsWindow.el.fadeIn();

            $(".itemsWindow").on("click tap", ".itemsList .itemItem", function(evt) {
                var itemName = $(this).data("name");
                var itemSource = $(this).data("source");
                createItemStatBlock(itemName, itemSource);
            });

            let searchTimeout;
            $(".itemsWindow").on("keyup", ".searchItems", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const itemsList = $(".itemsWindow .itemsList");
                    itemsList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "item");
                    console.log(results);
                    $.each(results, function(i, item) {
                        if (i > 100) return;
                        var itemType = (typeof item.type != "undefined") ? Renderer.item.getItemTypeName(item.type) : "-";
                        var itemRarity = item.rarity.toLowerCase();
                        var tr = `<tr class='itemItem' data-name="${item.name}" data-source="${item.source}">

                            <td>${item.name}</td>
                            <td>${itemType}</td>
                            <td>${itemRarity}</td>
                            <td title='${item.source?Parser.sourceJsonToFull(item.source):"N/A"}'>${item.source?item.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);
                    });
                    itemsList.append(tbody);
                }, 500);
            });
        } else {
            if ($(".itemsWindow").css("display") == "block" && $(".itemsWindow").hasClass("focused")) {
                $(".itemsWindow").css("display", "none");
                return;
            } else {
                $(".itemsWindow").fadeIn();
            }
        }
    });

    // Open and close the spells window
    $(".showSpells").on("click tap", function(evt) {
        if ($(".spellsWindow").length == 0) {
            var spellsWindow = new MythicForgeWindow(WinManager);
            spellsWindow.createWindow("Spells", `
                <div class="spellsContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchSpells" placeholder="Search here">
                <table class="spellsList">
                    <thead>
                        <tr>
                            <th>Spell</th>
                            <th>Level</th>
                            <th>School</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `,{class: "spellsWindow"});

            spellsWindow.el.fadeIn();

            $(".spellsWindow").on("click tap", ".spellsList .spellItem", function(evt) {
                var spellName = $(this).data("name");
                var spellSource = $(this).data("source");
                createSpellStatBlock(spellName, spellSource);
            });

            let searchTimeout;
            $(".spellsWindow").on("keyup", ".searchSpells", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const spellsList = $(".spellsWindow .spellsList");
                    spellsList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "spell");
                    $.each(results, function(i, spell) {
                        if (i > 100) return;
                        var spellLevel = spell.level;
                        var spellSchool = Parser.spSchoolAndSubschoolsAbvsToFull(spell.school);
                        var tr = `<tr class="spellItem" data-name="${spell.name}" data-source="${spell.source}">
                            <td>${spell.name}</td>
                            <td>${spellLevel}</td>
                            <td>${spellSchool}</td>
                            <td title='${spell.source?Parser.sourceJsonToFull(spell.source):"N/A"}'>${spell.source?spell.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (spell.reprintedAs) {
                            $.each(spell.reprintedAs, function(r, reprinted) {
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class="spellItem" data-name="${reprintedName}" data-source="${reprintedSource}">
                                    <td>${reprintedName}</td>
                                    <td>${spellLevel}</td>
                                    <td>${spellSchool}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }
                    });
                    spellsList.append(tbody);
                }, 500);
            });
        } else {
            if ($(".spellsWindow").css("display") == "block" && $(".spellsWindow").hasClass("focused")) {
                $(".spellsWindow").css("display", "none");
                return;
            } else {
                $(".spellsWindow").fadeIn();
            }
        }
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow(WinManager);
            bestiaryWindow.createWindow("Bestiary", `
                <div class="bestiaryContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
                <table class="bestiaryList">
                    <thead>
                        <tr>
                            <th>Monster</th>
                            <th>Type</th>
                            <th>CR</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `,{class: "bestiaryWindow"});

            bestiaryWindow.el.fadeIn();

            $(".bestiaryWindow").on("click tap", ".bestiaryList .bestiaryItem", function(evt) {
                var monsterName = $(this).data("name");
                var monsterSource = $(this).data("source");
                createMonsterStatBlock(monsterName, monsterSource);
            });

            let searchTimeout;
            $(".bestiaryWindow").on("keyup", ".searchBestiary", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const bestiaryList = $(".bestiaryWindow .bestiaryList");
                    bestiaryList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "monster");
                    $.each(results, function(i, monster) {
                        if (i > 100) return;
                        var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                        var monsterCR = (monster.cr) ? monster.cr : "-";
                        if (typeof monsterCR == "object") monsterCR = monsterCR.cr;
                        var tr = `<tr class='bestiaryItem' data-name="${monster.name}" data-source="${monster.source}">
                            <td>${monster.name}</td>
                            <td>${monsterAlignment}</td>
                            <td>${monsterCR}</td>
                            <td title='${monster.source?Parser.sourceJsonToFull(monster.source):"N/A"}'>${monster.source?monster.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (monster.reprintedAs) {
                            $.each(monster.reprintedAs, function(r, reprinted) {
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class='bestiaryItem' data-name="${reprintedName}" data-source="${reprintedSource}">
                                    <td>${reprintedName}</td>
                                    <td>${monsterAlignment}</td>
                                    <td>${monsterCR}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }
                    });
                    bestiaryList.append(tbody);
                }, 500);
            });
        } else {
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            } else {
                $(".bestiaryWindow").fadeIn();
            }
        }
    });

    // Open and close the characters window
    $(".showChars").off("click tap").on("click tap",openCharactersWindow);
});

/**
 * Searches through all monsters based on a search term and returns matching results
 * @param {string} term - The search term to look for in monster properties
 * @param {string} where - Currently unused parameter indicating search location
 * @returns {Array} Array of monster objects that match the search criteria
 * @description Searches monster names, sources and types for matches to the search term.
 * If SRDonly flag is true, only returns monsters from the SRD (System Reference Document).
 * The search is case-insensitive and uses partial matching.
 */
function SearchAll(term, where) {
    var results = [];

    switch (where.toLowerCase()) {
        case "item":
            $.each(AllItems, function(itemIndex, item) {
                if (SRDonly)
                    if (typeof item.srd != "undefined") {
                        //if srd is true, then the item is from the srd
                        if (!item.srd) {
                            //remove the item from the list
                            return;
                        }
                    } else {
                        //remove the item from the list
                        return;
                    }

                var itemName = item.name.toLowerCase();
                var itemSource = item.source.toLowerCase();

                if (itemName.toLowerCase().includes(term) || itemSource.toLowerCase().includes(term)){
                    console.log(item);
                    results.push(item);
                }
            });
            break;
        case "monster":
            $.each(AllMonsters, function(monsterIndex, monster) {
                if (SRDonly)
                    if (typeof monster.srd != "undefined") {
                        //if srd is true, then the monster is from the srd
                        if (!monster.srd) {
                            //remove the monster from the list
                            return;
                        }
                    } else {
                        //remove the monster from the list
                        return;
                    }

                var monsterName = monster.name.toLowerCase();
                var monsterSource = monster.source.toLowerCase();
                var monsterType = "";

                if (monster.type.type) {
                    if (typeof monster.type.type != "string") {
                        if (monster.type.type.choose)
                            monsterType = monster.type.type.choose.join(", ").toLowerCase();
                    } else {
                        monsterType = monster.type.type.toLowerCase();
                    }
                }

                if (monsterName.toLowerCase().includes(term) || monsterSource.toLowerCase().includes(term) || monsterType.toLowerCase().includes(term)) {
                    results.push(monster);
                }
            });
            break;
        case "spell":
            $.each(AllSpells, function(spellIndex, spell) {
                if (SRDonly)
                    if (typeof spell.srd != "undefined") {
                        //if srd is true, then the spell is from the srd
                        if (!spell.srd) {
                            //remove the spell from the list
                            return;
                        }
                    } else {
                        //remove the spell from the list
                        return;
                    }

                var spellName = spell.name.toLowerCase();
                var spellSource = spell.source.toLowerCase();

                if (spellName.toLowerCase().includes(term) || spellSource.toLowerCase().includes(term))
                    results.push(spell);
            });
            break;
        default:

            break;
    }
    return results;
}

/**
 * Creates and displays a monster stat block window using MythicForge
 * @param {string} monster - The name of the monster to display
 * @param {string} source - The source book or reference where the monster data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createMonsterStatBlock(monster, source) {
    var monsterStatBlock = new MythicForgeWindow(WinManager,monster+source);
    monsterStatBlock.monsterStatsHTML(monster, source);
}

/**
 * Creates and displays a spell stat block window using MythicForge
 * @param {string} spell - The name of the spell to display
 * @param {string} source - The source book or reference where the spell data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createSpellStatBlock(spell, source) {
    var spellStatBlock = new MythicForgeWindow(WinManager,spell+source);
    spellStatBlock.spellStatsHTML(spell, source);
}

/**
 * Creates and displays an item stat block window using MythicForge
 * @param {string} item - The name of the item to display
 * @param {string} source - The source book or reference where the item data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createItemStatBlock(item, source) {
    var itemStatBlock = new MythicForgeWindow(WinManager,item+source);
    itemStatBlock.itemStatsHTML(item, source);
}

/**
 * Retrieves user settings from localStorage or creates default settings if none exist
 * @returns {Object} The user settings object containing:
 *  - srd_content {boolean} Whether SRD content is enabled
 *  - using_ai {boolean} Whether AI features are enabled
 */
function getUserSettings() {
    var settings = localStorage.getItem("userSettings");
    if (settings) {
        settings = JSON.parse(settings);
    } else {
        settings = {
            srd_content: true,
            using_ai: false
        };
        localStorage.setItem("userSettings", JSON.stringify(settings));
    }
    return settings;
}

Object.assign(globalThis, {
    WinManager,
    getUserSettings
});